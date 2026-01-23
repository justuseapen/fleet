import type { TaskAdapter } from './base.js';
import type { UnifiedTask, GitHubConfig } from '../types.js';
import { execSync } from 'child_process';

/**
 * GitHub adapter using the gh CLI for API access.
 * This approach leverages existing gh auth rather than requiring a separate token.
 */
export class GitHubAdapter implements TaskAdapter {
    private config: GitHubConfig;

    constructor(config: GitHubConfig) {
        this.config = config;

        // Verify gh CLI is available and authenticated
        try {
            execSync('gh auth status', { stdio: 'pipe' });
        } catch {
            throw new Error('GitHub CLI (gh) not authenticated. Run `gh auth login` first.');
        }
    }

    async fetchTasks(): Promise<UnifiedTask[]> {
        const { owner, repo, labels } = this.config;

        let command = `gh issue list --repo ${owner}/${repo} --state open --json number,title,body,labels,assignees,url --limit 50`;

        if (labels && labels.length > 0) {
            command += ` --label "${labels.join(',')}"`;
        }

        try {
            const output = execSync(command, { encoding: 'utf-8' });
            const issues = JSON.parse(output) as Array<{
                number: number;
                title: string;
                body: string | null;
                labels: Array<{ name: string }>;
                assignees: Array<{ login: string }>;
                url: string;
            }>;

            return issues.map(issue => this.mapToUnifiedTask(issue));
        } catch (error) {
            throw new Error(`Failed to fetch GitHub issues: ${error}`);
        }
    }

    private mapToUnifiedTask(issue: {
        number: number;
        title: string;
        body: string | null;
        labels: Array<{ name: string }>;
        assignees: Array<{ login: string }>;
        url: string;
    }): UnifiedTask {
        const labelNames = issue.labels.map(l => l.name);

        return {
            externalId: String(issue.number),
            externalUrl: issue.url,
            title: issue.title,
            description: issue.body,
            taskType: this.inferTaskType(labelNames, issue.title),
            priority: this.inferPriority(labelNames),
            labels: labelNames,
            assignee: issue.assignees[0]?.login || null,
        };
    }

    private inferTaskType(labels: string[], title: string): UnifiedTask['taskType'] {
        const labelsLower = labels.map(l => l.toLowerCase());
        const titleLower = title.toLowerCase();

        if (labelsLower.includes('bug') || titleLower.includes('bug') || titleLower.includes('fix')) {
            return 'bug';
        }
        if (labelsLower.includes('enhancement') || labelsLower.includes('feature')) {
            return 'feature';
        }
        if (labelsLower.includes('refactor') || titleLower.includes('refactor')) {
            return 'refactor';
        }
        return 'chore';
    }

    private inferPriority(labels: string[]): UnifiedTask['priority'] {
        const labelsLower = labels.map(l => l.toLowerCase());

        if (labelsLower.some(l => l.includes('critical') || l.includes('urgent') || l.includes('p0'))) {
            return 'critical';
        }
        if (labelsLower.some(l => l.includes('high') || l.includes('p1') || l.includes('priority'))) {
            return 'high';
        }
        if (labelsLower.some(l => l.includes('low') || l.includes('p3'))) {
            return 'low';
        }
        return 'medium';
    }

    async updateTaskStatus(externalId: string, status: string): Promise<void> {
        const { owner, repo } = this.config;

        if (status.toLowerCase() === 'done' || status.toLowerCase() === 'closed') {
            try {
                execSync(`gh issue close ${externalId} --repo ${owner}/${repo}`, { stdio: 'pipe' });
            } catch (error) {
                throw new Error(`Failed to close GitHub issue: ${error}`);
            }
        } else if (status.toLowerCase() === 'open' || status.toLowerCase() === 'reopen') {
            try {
                execSync(`gh issue reopen ${externalId} --repo ${owner}/${repo}`, { stdio: 'pipe' });
            } catch (error) {
                throw new Error(`Failed to reopen GitHub issue: ${error}`);
            }
        }
    }

    async addComment(externalId: string, comment: string): Promise<void> {
        const { owner, repo } = this.config;

        try {
            execSync(`gh issue comment ${externalId} --repo ${owner}/${repo} --body "${comment.replace(/"/g, '\\"')}"`, {
                stdio: 'pipe',
            });
        } catch (error) {
            throw new Error(`Failed to add comment to GitHub issue: ${error}`);
        }
    }

    /**
     * Create a pull request for completed work
     */
    async createPullRequest(branch: string, title: string, body: string): Promise<string> {
        const { owner, repo } = this.config;

        try {
            const output = execSync(
                `gh pr create --repo ${owner}/${repo} --head ${branch} --title "${title.replace(/"/g, '\\"')}" --body "${body.replace(/"/g, '\\"')}"`,
                { encoding: 'utf-8' }
            );
            return output.trim(); // Returns PR URL
        } catch (error) {
            throw new Error(`Failed to create pull request: ${error}`);
        }
    }
}
