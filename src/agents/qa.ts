import { execSync } from 'child_process';
import Anthropic from '@anthropic-ai/sdk';
import type { Agent, AgentContext, AgentResult } from './base.js';
import { insertWorkLog, generateId } from '../db/index.js';

const QA_SYSTEM_PROMPT = `You are an expert code reviewer. Your job is to review pull request diffs and provide constructive feedback.

Focus on:
1. Code correctness and potential bugs
2. Security vulnerabilities
3. Performance issues
4. Code style and readability
5. Missing tests or documentation

Be concise but thorough. Provide specific line numbers when referencing issues.

Output your review in this format:
- **Summary**: One sentence overview
- **Issues Found**: List of issues with severity (Critical/Major/Minor)
- **Suggestions**: Optional improvements
- **Verdict**: APPROVE, REQUEST_CHANGES, or COMMENT`;

/**
 * QA agent that reviews pull requests
 */
export class QaAgent implements Agent {
    name = 'qa';
    description = 'Reviews pull requests and provides feedback';

    private client: Anthropic;

    constructor(apiKey?: string) {
        this.client = new Anthropic({
            apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
        });
    }

    async execute(context: AgentContext): Promise<AgentResult> {
        const { project, run, workDir } = context;

        if (!run?.pr_url) {
            return {
                success: false,
                error: 'No PR URL available for QA review',
            };
        }

        try {
            // Extract PR number from URL
            const prNumber = this.extractPrNumber(run.pr_url);
            if (!prNumber) {
                return {
                    success: false,
                    error: `Could not extract PR number from URL: ${run.pr_url}`,
                };
            }

            // Get PR diff
            const diff = await this.getPrDiff(workDir, prNumber);
            if (!diff) {
                return {
                    success: false,
                    error: 'Failed to get PR diff',
                };
            }

            // Review with Claude
            const review = await this.reviewCode(diff);

            // Post review to GitHub
            await this.postReview(workDir, prNumber, review);

            insertWorkLog({
                id: generateId(),
                run_id: run.id,
                project_id: project.id,
                event_type: review.verdict === 'APPROVE' ? 'completed' : 'started',
                summary: `QA Review: ${review.verdict}`,
                details: JSON.stringify({
                    verdict: review.verdict,
                    issues: review.issues.length,
                    pr_number: prNumber,
                }),
            });

            return {
                success: true,
                output: `Review completed: ${review.verdict} (${review.issues.length} issues)`,
                artifacts: {
                    verdict: review.verdict,
                    issues: review.issues,
                    summary: review.summary,
                },
            };
        } catch (error) {
            return {
                success: false,
                error: `QA review failed: ${error}`,
            };
        }
    }

    private extractPrNumber(url: string): string | null {
        const match = url.match(/\/pull\/(\d+)/);
        return match ? match[1] : null;
    }

    private async getPrDiff(workDir: string, prNumber: string): Promise<string | null> {
        try {
            const diff = execSync(`gh pr diff ${prNumber}`, {
                cwd: workDir,
                encoding: 'utf-8',
                maxBuffer: 10 * 1024 * 1024, // 10MB
            });
            return diff;
        } catch {
            return null;
        }
    }

    private async reviewCode(diff: string): Promise<{
        summary: string;
        issues: Array<{ severity: string; description: string; line?: number }>;
        suggestions: string[];
        verdict: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
    }> {
        // Truncate diff if too large
        const maxDiffLength = 50000;
        const truncatedDiff = diff.length > maxDiffLength
            ? diff.substring(0, maxDiffLength) + '\n\n[Diff truncated...]'
            : diff;

        const message = await this.client.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 2048,
            system: QA_SYSTEM_PROMPT,
            messages: [
                {
                    role: 'user',
                    content: `Please review the following pull request diff:\n\n\`\`\`diff\n${truncatedDiff}\n\`\`\``,
                },
            ],
        });

        const responseText = message.content
            .filter(block => block.type === 'text')
            .map(block => (block as { type: 'text'; text: string }).text)
            .join('\n');

        return this.parseReview(responseText);
    }

    private parseReview(response: string): {
        summary: string;
        issues: Array<{ severity: string; description: string; line?: number }>;
        suggestions: string[];
        verdict: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
    } {
        // Extract summary
        const summaryMatch = response.match(/\*\*Summary\*\*:?\s*(.+?)(?=\n|$)/i);
        const summary = summaryMatch ? summaryMatch[1].trim() : 'Review completed';

        // Extract issues
        const issues: Array<{ severity: string; description: string; line?: number }> = [];
        const issuesSection = response.match(/\*\*Issues Found\*\*:?([\s\S]*?)(?=\*\*Suggestions|$)/i);
        if (issuesSection) {
            const issueLines = issuesSection[1].split('\n').filter(l => l.trim().startsWith('-'));
            for (const line of issueLines) {
                const severityMatch = line.match(/\((Critical|Major|Minor)\)/i);
                issues.push({
                    severity: severityMatch ? severityMatch[1] : 'Minor',
                    description: line.replace(/^-\s*/, '').replace(/\((?:Critical|Major|Minor)\)/i, '').trim(),
                });
            }
        }

        // Extract suggestions
        const suggestions: string[] = [];
        const suggestionsSection = response.match(/\*\*Suggestions\*\*:?([\s\S]*?)(?=\*\*Verdict|$)/i);
        if (suggestionsSection) {
            const suggestionLines = suggestionsSection[1].split('\n').filter(l => l.trim().startsWith('-'));
            for (const line of suggestionLines) {
                suggestions.push(line.replace(/^-\s*/, '').trim());
            }
        }

        // Extract verdict
        let verdict: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT' = 'COMMENT';
        const verdictMatch = response.match(/\*\*Verdict\*\*:?\s*(APPROVE|REQUEST_CHANGES|COMMENT)/i);
        if (verdictMatch) {
            verdict = verdictMatch[1].toUpperCase() as typeof verdict;
        } else {
            // Infer from issues
            const hasCritical = issues.some(i => i.severity.toLowerCase() === 'critical');
            const hasMajor = issues.some(i => i.severity.toLowerCase() === 'major');
            if (hasCritical || hasMajor) {
                verdict = 'REQUEST_CHANGES';
            } else if (issues.length === 0) {
                verdict = 'APPROVE';
            }
        }

        return { summary, issues, suggestions, verdict };
    }

    private async postReview(
        workDir: string,
        prNumber: string,
        review: {
            summary: string;
            issues: Array<{ severity: string; description: string }>;
            suggestions: string[];
            verdict: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
        }
    ): Promise<void> {
        // Build review body
        let body = `## Fleet QA Review\n\n${review.summary}\n\n`;

        if (review.issues.length > 0) {
            body += '### Issues\n\n';
            for (const issue of review.issues) {
                const emoji = issue.severity === 'Critical' ? '🔴' :
                    issue.severity === 'Major' ? '🟠' : '🟡';
                body += `- ${emoji} **${issue.severity}**: ${issue.description}\n`;
            }
            body += '\n';
        }

        if (review.suggestions.length > 0) {
            body += '### Suggestions\n\n';
            for (const suggestion of review.suggestions) {
                body += `- 💡 ${suggestion}\n`;
            }
            body += '\n';
        }

        body += `\n---\n*Automated review by Fleet QA Agent*`;

        // Map verdict to gh review action
        const reviewAction = review.verdict === 'APPROVE' ? '--approve' :
            review.verdict === 'REQUEST_CHANGES' ? '--request-changes' : '--comment';

        try {
            execSync(
                `gh pr review ${prNumber} ${reviewAction} --body "${body.replace(/"/g, '\\"')}"`,
                { cwd: workDir, stdio: 'pipe' }
            );
        } catch (error) {
            throw new Error(`Failed to post review: ${error}`);
        }
    }
}
