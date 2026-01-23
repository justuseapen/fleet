import type { TaskAdapter } from './base.js';
import type { UnifiedTask, JiraConfig } from '../types.js';

/**
 * Jira adapter that wraps MCP tool calls.
 * In production, these would be actual MCP tool invocations.
 * For now, we use the Jira REST API directly.
 */
export class JiraAdapter implements TaskAdapter {
    private config: JiraConfig;
    private baseUrl: string;
    private auth: string;

    constructor(config: JiraConfig) {
        this.config = config;

        const site = process.env.ATLASSIAN_SITE;
        const email = process.env.ATLASSIAN_EMAIL;
        const token = process.env.ATLASSIAN_API_TOKEN;

        if (!site || !email || !token) {
            throw new Error('Missing Jira credentials. Set ATLASSIAN_SITE, ATLASSIAN_EMAIL, and ATLASSIAN_API_TOKEN');
        }

        this.baseUrl = `https://${site}.atlassian.net/rest/api/3`;
        this.auth = Buffer.from(`${email}:${token}`).toString('base64');
    }

    async fetchTasks(): Promise<UnifiedTask[]> {
        const jql = this.config.jql || `project = ${this.config.project} AND status != Done ORDER BY priority DESC`;

        const response = await fetch(`${this.baseUrl}/search?jql=${encodeURIComponent(jql)}&maxResults=50`, {
            headers: {
                'Authorization': `Basic ${this.auth}`,
                'Accept': 'application/json',
            },
        });

        if (!response.ok) {
            throw new Error(`Jira API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json() as {
            issues: Array<{
                key: string;
                fields: {
                    summary: string;
                    description?: { content?: Array<{ content?: Array<{ text?: string }> }> };
                    issuetype?: { name?: string };
                    priority?: { name?: string };
                    labels?: string[];
                    assignee?: { displayName?: string };
                };
            }>;
        };

        return data.issues.map((issue) => this.mapToUnifiedTask(issue));
    }

    private mapToUnifiedTask(issue: {
        key: string;
        fields: {
            summary: string;
            description?: { content?: Array<{ content?: Array<{ text?: string }> }> };
            issuetype?: { name?: string };
            priority?: { name?: string };
            labels?: string[];
            assignee?: { displayName?: string };
        };
    }): UnifiedTask {
        const fields = issue.fields;

        // Extract description text from Atlassian Document Format
        let description: string | null = null;
        if (fields.description?.content) {
            description = fields.description.content
                .flatMap(block => block.content || [])
                .filter(inline => inline.text)
                .map(inline => inline.text)
                .join('\n');
        }

        return {
            externalId: issue.key,
            externalUrl: `https://${process.env.ATLASSIAN_SITE}.atlassian.net/browse/${issue.key}`,
            title: fields.summary,
            description,
            taskType: this.mapIssueType(fields.issuetype?.name),
            priority: this.mapPriority(fields.priority?.name),
            labels: fields.labels || [],
            assignee: fields.assignee?.displayName || null,
        };
    }

    private mapIssueType(issueType?: string): UnifiedTask['taskType'] {
        const type = issueType?.toLowerCase() || '';
        if (type.includes('bug')) return 'bug';
        if (type.includes('story') || type.includes('feature')) return 'feature';
        if (type.includes('refactor')) return 'refactor';
        return 'chore';
    }

    private mapPriority(priority?: string): UnifiedTask['priority'] {
        const p = priority?.toLowerCase() || '';
        if (p.includes('highest') || p.includes('critical') || p.includes('blocker')) return 'critical';
        if (p.includes('high')) return 'high';
        if (p.includes('medium') || p.includes('normal')) return 'medium';
        return 'low';
    }

    async updateTaskStatus(externalId: string, status: string): Promise<void> {
        // Get available transitions
        const transitionsResponse = await fetch(
            `${this.baseUrl}/issue/${externalId}/transitions`,
            {
                headers: {
                    'Authorization': `Basic ${this.auth}`,
                    'Accept': 'application/json',
                },
            }
        );

        if (!transitionsResponse.ok) {
            throw new Error(`Failed to get transitions: ${transitionsResponse.statusText}`);
        }

        const transitionsData = await transitionsResponse.json() as {
            transitions: Array<{ id: string; name: string }>;
        };

        const transition = transitionsData.transitions.find(
            t => t.name.toLowerCase().includes(status.toLowerCase())
        );

        if (!transition) {
            console.warn(`No transition found for status "${status}" on ${externalId}`);
            return;
        }

        // Perform transition
        const response = await fetch(`${this.baseUrl}/issue/${externalId}/transitions`, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${this.auth}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                transition: { id: transition.id },
            }),
        });

        if (!response.ok) {
            throw new Error(`Failed to transition issue: ${response.statusText}`);
        }
    }

    async addComment(externalId: string, comment: string): Promise<void> {
        const response = await fetch(`${this.baseUrl}/issue/${externalId}/comment`, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${this.auth}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                body: {
                    type: 'doc',
                    version: 1,
                    content: [
                        {
                            type: 'paragraph',
                            content: [{ type: 'text', text: comment }],
                        },
                    ],
                },
            }),
        });

        if (!response.ok) {
            throw new Error(`Failed to add comment: ${response.statusText}`);
        }
    }
}
