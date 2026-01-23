import type { TaskAdapter } from '../base.js';
import type { UnifiedTask, LinearConfig } from '../../types.js';
import { LinearClient, type LinearIssue } from './client.js';

export class LinearAdapter implements TaskAdapter {
    private config: LinearConfig;
    private client: LinearClient;

    constructor(config: LinearConfig) {
        this.config = config;
        this.client = new LinearClient();
    }

    async fetchTasks(): Promise<UnifiedTask[]> {
        const issues = await this.client.getIssues(
            this.config.teamId,
            this.config.projectId
        );

        return issues.map(issue => this.mapToUnifiedTask(issue));
    }

    private mapToUnifiedTask(issue: LinearIssue): UnifiedTask {
        return {
            externalId: issue.id,
            externalUrl: issue.url,
            title: issue.title,
            description: issue.description,
            taskType: this.inferTaskType(issue),
            priority: this.mapPriority(issue.priority),
            labels: issue.labels.nodes.map(l => l.name),
            assignee: issue.assignee?.name || null,
        };
    }

    private inferTaskType(issue: LinearIssue): UnifiedTask['taskType'] {
        const labelNames = issue.labels.nodes.map(l => l.name.toLowerCase());
        const titleLower = issue.title.toLowerCase();

        if (labelNames.includes('bug') || titleLower.includes('bug') || titleLower.includes('fix')) {
            return 'bug';
        }
        if (labelNames.includes('feature') || labelNames.includes('enhancement')) {
            return 'feature';
        }
        if (labelNames.includes('refactor') || titleLower.includes('refactor')) {
            return 'refactor';
        }
        return 'chore';
    }

    private mapPriority(priority: number): UnifiedTask['priority'] {
        // Linear: 0 = No priority, 1 = Urgent, 2 = High, 3 = Normal, 4 = Low
        switch (priority) {
            case 1: return 'critical';
            case 2: return 'high';
            case 3: return 'medium';
            case 4: return 'low';
            default: return null;
        }
    }

    async updateTaskStatus(externalId: string, status: string): Promise<void> {
        // Get workflow states for the team
        const states = await this.client.getWorkflowStates(this.config.teamId);

        // Find a matching state
        const statusLower = status.toLowerCase();
        const state = states.find(s =>
            s.name.toLowerCase().includes(statusLower) ||
            s.type.toLowerCase() === statusLower
        );

        if (!state) {
            console.warn(`No matching state found for "${status}" in Linear`);
            return;
        }

        await this.client.updateIssueState(externalId, state.id);
    }

    async addComment(externalId: string, comment: string): Promise<void> {
        await this.client.addComment(externalId, comment);
    }
}
