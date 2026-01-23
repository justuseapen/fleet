import { execSync } from 'child_process';
import Anthropic from '@anthropic-ai/sdk';
import type { Agent, AgentContext, AgentResult } from './base.js';
import { insertAudit, generateId, getAllProjects, getWorkLogByProject } from '../db/index.js';

const STRATEGIC_SYSTEM_PROMPT = `You are a strategic advisor for software development projects. Your job is to audit recent development work and ensure it aligns with the project's mission and goals.

Analyze:
1. **Mission Alignment**: Do recent commits align with the stated project mission?
2. **Scope Creep**: Are there features or changes that seem outside the project's scope?
3. **Technical Debt**: Are there signs of accumulating technical debt?
4. **Progress**: Is the project making meaningful progress toward its goals?
5. **Recommendations**: What should be prioritized next?

Be direct and actionable. Focus on high-level strategic concerns, not code-level details.

Output your audit in this format:
- **Mission Alignment Score**: 1-10
- **Scope Creep Risk**: Low/Medium/High
- **Key Observations**: Bullet points
- **Recommendations**: Prioritized list
- **Red Flags**: Any serious concerns (or "None")`;

/**
 * Strategic agent that audits projects for mission alignment
 */
export class StrategicAgent implements Agent {
    name = 'strategic';
    description = 'Audits projects for mission alignment and scope creep';

    private client: Anthropic;

    constructor(apiKey?: string) {
        this.client = new Anthropic({
            apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
        });
    }

    async execute(context: AgentContext): Promise<AgentResult> {
        const { project, workDir } = context;

        try {
            // Gather project context
            const recentCommits = await this.getRecentCommits(workDir, 50);
            const workLog = getWorkLogByProject(project.id, 100);

            // Run strategic audit
            const audit = await this.runAudit(project, recentCommits, workLog);

            // Store audit
            insertAudit({
                id: generateId(),
                project_id: project.id,
                report: audit.report,
                recommendations: JSON.stringify(audit.recommendations),
                scope_creep_detected: audit.scopeCreepRisk === 'High' ? 1 : 0,
            });

            return {
                success: true,
                output: `Strategic audit complete. Mission alignment: ${audit.missionScore}/10, Scope creep risk: ${audit.scopeCreepRisk}`,
                artifacts: {
                    missionScore: audit.missionScore,
                    scopeCreepRisk: audit.scopeCreepRisk,
                    recommendations: audit.recommendations,
                    redFlags: audit.redFlags,
                },
            };
        } catch (error) {
            return {
                success: false,
                error: `Strategic audit failed: ${error}`,
            };
        }
    }

    /**
     * Run a cross-project audit (all registered projects)
     */
    async runCrossProjectAudit(): Promise<{
        report: string;
        projectSummaries: Array<{ project: string; score: number; risk: string }>;
    }> {
        const projects = getAllProjects();
        const summaries: Array<{ project: string; score: number; risk: string }> = [];

        let crossProjectReport = '# Fleet Cross-Project Strategic Audit\n\n';
        crossProjectReport += `Generated: ${new Date().toISOString()}\n\n`;

        for (const project of projects) {
            try {
                const recentCommits = await this.getRecentCommits(project.path, 30);
                const workLog = getWorkLogByProject(project.id, 50);
                const audit = await this.runAudit(project, recentCommits, workLog);

                summaries.push({
                    project: project.name,
                    score: audit.missionScore,
                    risk: audit.scopeCreepRisk,
                });

                crossProjectReport += `## ${project.name}\n\n`;
                crossProjectReport += `- Mission Alignment: ${audit.missionScore}/10\n`;
                crossProjectReport += `- Scope Creep Risk: ${audit.scopeCreepRisk}\n`;
                if (audit.redFlags.length > 0) {
                    crossProjectReport += `- 🚨 Red Flags: ${audit.redFlags.join(', ')}\n`;
                }
                crossProjectReport += '\n';
            } catch (error) {
                crossProjectReport += `## ${project.name}\n\n`;
                crossProjectReport += `⚠️ Audit failed: ${error}\n\n`;
            }
        }

        // Store cross-project audit
        insertAudit({
            id: generateId(),
            project_id: null, // Cross-project
            report: crossProjectReport,
            recommendations: JSON.stringify(summaries),
            scope_creep_detected: summaries.some(s => s.risk === 'High') ? 1 : 0,
        });

        return {
            report: crossProjectReport,
            projectSummaries: summaries,
        };
    }

    private async getRecentCommits(workDir: string, count: number): Promise<string[]> {
        try {
            const output = execSync(
                `git log --oneline -${count} --format="%h %s"`,
                { cwd: workDir, encoding: 'utf-8' }
            );
            return output.trim().split('\n').filter(Boolean);
        } catch {
            return [];
        }
    }

    private async runAudit(
        project: { name: string; mission: string | null },
        commits: string[],
        workLog: Array<{ summary: string; event_type: string }>
    ): Promise<{
        missionScore: number;
        scopeCreepRisk: 'Low' | 'Medium' | 'High';
        observations: string[];
        recommendations: string[];
        redFlags: string[];
        report: string;
    }> {
        const workLogSummary = workLog.slice(0, 20)
            .map(w => `[${w.event_type}] ${w.summary}`)
            .join('\n');

        const prompt = `Audit the following project:

**Project**: ${project.name}
**Mission**: ${project.mission || 'Not specified'}

**Recent Commits** (last ${commits.length}):
${commits.slice(0, 30).join('\n')}

**Recent Work Log**:
${workLogSummary || 'No recent work logged'}

Please provide a strategic audit following the format specified.`;

        const message = await this.client.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 2048,
            system: STRATEGIC_SYSTEM_PROMPT,
            messages: [{ role: 'user', content: prompt }],
        });

        const responseText = message.content
            .filter(block => block.type === 'text')
            .map(block => (block as { type: 'text'; text: string }).text)
            .join('\n');

        return this.parseAudit(responseText);
    }

    private parseAudit(response: string): {
        missionScore: number;
        scopeCreepRisk: 'Low' | 'Medium' | 'High';
        observations: string[];
        recommendations: string[];
        redFlags: string[];
        report: string;
    } {
        // Extract mission score
        const scoreMatch = response.match(/Mission Alignment Score\*\*:?\s*(\d+)/i);
        const missionScore = scoreMatch ? parseInt(scoreMatch[1], 10) : 5;

        // Extract scope creep risk
        let scopeCreepRisk: 'Low' | 'Medium' | 'High' = 'Medium';
        const riskMatch = response.match(/Scope Creep Risk\*\*:?\s*(Low|Medium|High)/i);
        if (riskMatch) {
            scopeCreepRisk = riskMatch[1] as typeof scopeCreepRisk;
        }

        // Extract observations
        const observations: string[] = [];
        const obsSection = response.match(/Key Observations\*\*:?([\s\S]*?)(?=\*\*Recommendations|$)/i);
        if (obsSection) {
            const lines = obsSection[1].split('\n').filter(l => l.trim().startsWith('-'));
            observations.push(...lines.map(l => l.replace(/^-\s*/, '').trim()));
        }

        // Extract recommendations
        const recommendations: string[] = [];
        const recSection = response.match(/Recommendations\*\*:?([\s\S]*?)(?=\*\*Red Flags|$)/i);
        if (recSection) {
            const lines = recSection[1].split('\n').filter(l => l.trim().match(/^[-\d]/));
            recommendations.push(...lines.map(l => l.replace(/^[-\d.)\s]+/, '').trim()));
        }

        // Extract red flags
        const redFlags: string[] = [];
        const flagSection = response.match(/Red Flags\*\*:?([\s\S]*?)$/i);
        if (flagSection && !flagSection[1].toLowerCase().includes('none')) {
            const lines = flagSection[1].split('\n').filter(l => l.trim().startsWith('-'));
            redFlags.push(...lines.map(l => l.replace(/^-\s*/, '').trim()));
        }

        return {
            missionScore,
            scopeCreepRisk,
            observations,
            recommendations,
            redFlags,
            report: response,
        };
    }
}
