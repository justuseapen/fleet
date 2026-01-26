import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import Anthropic from '@anthropic-ai/sdk';
import type { Agent, AgentContext, AgentResult } from './base.js';
import type { PrdJson } from '../types.js';
import { calculateRiskScore, extractRiskFactors, getRiskBreakdown } from '../approval/risk.js';
import {
    insertProposal,
    insertPrd,
    generateId,
    getLatestAudit,
    type Project,
    type Proposal,
} from '../db/index.js';

const VISIONARY_SYSTEM_PROMPT = `You are a strategic product visionary and technical architect. Your job is to analyze a project and proactively suggest valuable features or improvements that advance the project's mission.

Given the project context, generate feature proposals that:
1. **Align with Mission**: Directly advance the stated project goals
2. **Fill Gaps**: Address missing functionality or user needs
3. **Build on Momentum**: Leverage recent work to add natural extensions
4. **Stay Atomic**: Keep proposals small enough to complete in a single context window

For each proposal, provide:
- A clear, concise title
- Strong rationale explaining why this advances the mission
- A complete PRD with user stories

CRITICAL:
- Each user story MUST be completable in ONE context window by an AI agent
- Always include "Typecheck passes" in acceptance criteria
- Focus on high-value, low-risk improvements
- Prefer features that improve developer/user experience

Output your proposals in this exact format:

## Proposal 1: [Title]

### Rationale
[2-3 sentences explaining why this advances the mission]

### PRD Content
[Full PRD markdown]

### prd.json
\`\`\`json
{
  "project": "[projectName]",
  "branchName": "fleet/[slug]",
  "description": "[summary]",
  "userStories": [...]
}
\`\`\`

---

## Proposal 2: [Title]
...`;

const VISIONARY_USER_TEMPLATE = `Analyze the following project and generate {count} feature proposals:

**Project**: {projectName}
**Mission**: {mission}

**Recent Commits** (showing direction):
{recentCommits}

**README Context**:
{readmeContext}

**Package.json**:
{packageInfo}

**Strategic Audit Recommendations** (if available):
{auditRecommendations}

Generate {count} high-value feature proposals with complete PRDs. Focus on features that:
- Directly advance the stated mission
- Address gaps in current functionality
- Build naturally on recent work
- Can be completed autonomously`;

export interface VisionaryProposal {
    title: string;
    rationale: string;
    prdContent: string;
    prdJson: PrdJson;
}

/**
 * VisionaryAgent generates proactive feature proposals based on project mission
 */
export class VisionaryAgent implements Agent {
    name = 'visionary';
    description = 'Generates proactive feature proposals based on project mission';

    private client: Anthropic;

    constructor(apiKey?: string) {
        this.client = new Anthropic({
            apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
        });
    }

    async execute(context: AgentContext): Promise<AgentResult> {
        const { project, workDir } = context;

        try {
            // Generate proposals with default count
            const proposals = await this.generateProposals(project, workDir, 3);

            // Store proposals and PRDs
            const proposalIds: string[] = [];
            for (const proposal of proposals) {
                const { proposalId } = await this.storeProposal(project, proposal);
                proposalIds.push(proposalId);
            }

            return {
                success: true,
                output: `Generated ${proposals.length} feature proposals`,
                artifacts: {
                    proposalCount: proposals.length,
                    proposalIds,
                    titles: proposals.map(p => p.title),
                },
            };
        } catch (error) {
            return {
                success: false,
                error: `Failed to generate proposals: ${error}`,
            };
        }
    }

    /**
     * Generate feature proposals for a project
     */
    async generateProposals(
        project: Project,
        workDir: string,
        count: number = 3
    ): Promise<VisionaryProposal[]> {
        // Gather context
        const recentCommits = this.getRecentCommits(workDir, 20);
        const readmeContext = this.getReadmeContext(workDir);
        const packageInfo = this.getPackageInfo(workDir);
        const auditRecommendations = this.getAuditRecommendations(project.id);

        const prompt = VISIONARY_USER_TEMPLATE
            .replace(/{count}/g, String(count))
            .replace(/{projectName}/g, project.name)
            .replace(/{mission}/g, project.mission || 'Not specified - focus on general improvements')
            .replace(/{recentCommits}/g, recentCommits.join('\n') || 'No recent commits')
            .replace(/{readmeContext}/g, readmeContext || 'No README found')
            .replace(/{packageInfo}/g, packageInfo || 'No package.json found')
            .replace(/{auditRecommendations}/g, auditRecommendations || 'No recent audit');

        const message = await this.client.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 8192,
            system: VISIONARY_SYSTEM_PROMPT,
            messages: [{ role: 'user', content: prompt }],
        });

        const responseText = message.content
            .filter(block => block.type === 'text')
            .map(block => (block as { type: 'text'; text: string }).text)
            .join('\n');

        return this.parseProposals(responseText, project.name);
    }

    /**
     * Store a proposal and its PRD in the database
     */
    async storeProposal(
        project: Project,
        proposal: VisionaryProposal
    ): Promise<{ proposalId: string; prdId: string }> {
        const proposalId = generateId();
        const prdId = generateId();

        // Calculate risk score
        const riskFactors = extractRiskFactors(
            proposal.prdContent,
            proposal.prdJson,
            'feature'
        );
        const riskScore = calculateRiskScore(riskFactors);
        const riskBreakdown = getRiskBreakdown(riskFactors);

        // Insert proposal
        insertProposal({
            id: proposalId,
            project_id: project.id,
            title: proposal.title,
            rationale: proposal.rationale,
            source_context: JSON.stringify({
                generated_at: new Date().toISOString(),
                story_count: proposal.prdJson.userStories.length,
            }),
            status: 'proposed',
            converted_task_id: null,
        });

        // Insert PRD linked to proposal
        insertPrd({
            id: prdId,
            task_id: null,
            proposal_id: proposalId,
            project_id: project.id,
            content: proposal.prdContent,
            prd_json: JSON.stringify(proposal.prdJson),
            risk_score: riskScore,
            risk_factors: JSON.stringify(riskBreakdown),
            status: 'pending',
            approved_at: null,
            approved_by: null,
        });

        return { proposalId, prdId };
    }

    private getRecentCommits(workDir: string, count: number): string[] {
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

    private getReadmeContext(workDir: string): string {
        const readmePaths = ['README.md', 'readme.md', 'README', 'README.txt'];
        for (const name of readmePaths) {
            const path = join(workDir, name);
            if (existsSync(path)) {
                const content = readFileSync(path, 'utf-8');
                // Return first 2000 chars to stay within context limits
                return content.slice(0, 2000);
            }
        }
        return '';
    }

    private getPackageInfo(workDir: string): string {
        const packagePath = join(workDir, 'package.json');
        if (existsSync(packagePath)) {
            try {
                const pkg = JSON.parse(readFileSync(packagePath, 'utf-8'));
                return JSON.stringify({
                    name: pkg.name,
                    description: pkg.description,
                    scripts: Object.keys(pkg.scripts || {}),
                    dependencies: Object.keys(pkg.dependencies || {}),
                }, null, 2);
            } catch {
                return '';
            }
        }
        return '';
    }

    private getAuditRecommendations(projectId: string): string {
        const audit = getLatestAudit(projectId);
        if (audit && audit.recommendations) {
            try {
                const recs = JSON.parse(audit.recommendations);
                if (Array.isArray(recs)) {
                    return recs.slice(0, 5).join('\n- ');
                }
                return JSON.stringify(recs);
            } catch {
                return '';
            }
        }
        return '';
    }

    private parseProposals(response: string, projectName: string): VisionaryProposal[] {
        const proposals: VisionaryProposal[] = [];

        // Split by proposal headers
        const proposalBlocks = response.split(/##\s*Proposal\s*\d+:/i).slice(1);

        for (const block of proposalBlocks) {
            try {
                const proposal = this.parseProposalBlock(block, projectName);
                if (proposal) {
                    proposals.push(proposal);
                }
            } catch {
                // Skip malformed proposals
                continue;
            }
        }

        return proposals;
    }

    private parseProposalBlock(block: string, projectName: string): VisionaryProposal | null {
        // Extract title (first line after split)
        const titleMatch = block.match(/^\s*(.+?)(?:\n|###)/);
        const title = titleMatch ? titleMatch[1].trim() : 'Untitled Proposal';

        // Extract rationale
        const rationaleMatch = block.match(/###\s*Rationale\s*([\s\S]*?)(?=###\s*PRD Content|$)/i);
        const rationale = rationaleMatch ? rationaleMatch[1].trim() : '';

        // Extract PRD content
        const prdMatch = block.match(/###\s*PRD Content\s*([\s\S]*?)(?=###\s*prd\.json|```json)/i);
        const prdContent = prdMatch ? prdMatch[1].trim() : '';

        // Extract prd.json
        const jsonMatch = block.match(/```json\s*([\s\S]*?)\s*```/);
        let prdJson: PrdJson;

        if (jsonMatch) {
            try {
                prdJson = JSON.parse(jsonMatch[1]) as PrdJson;
            } catch {
                // Create default structure
                prdJson = this.createDefaultPrdJson(projectName, title);
            }
        } else {
            prdJson = this.createDefaultPrdJson(projectName, title);
        }

        // Skip if we don't have meaningful content
        if (!title || title === 'Untitled Proposal') {
            return null;
        }

        return {
            title,
            rationale,
            prdContent: prdContent || `# ${title}\n\n${rationale}`,
            prdJson,
        };
    }

    private createDefaultPrdJson(projectName: string, title: string): PrdJson {
        const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);
        return {
            project: projectName,
            branchName: `fleet/${slug}`,
            description: title,
            userStories: [
                {
                    id: 'US-001',
                    title: `Implement ${title}`,
                    description: `As a user, I want ${title.toLowerCase()} so that the project is improved`,
                    acceptanceCriteria: ['Implementation complete', 'Typecheck passes'],
                    priority: 1,
                    passes: false,
                    notes: '',
                },
            ],
        };
    }
}
