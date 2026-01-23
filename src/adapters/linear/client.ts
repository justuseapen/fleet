/**
 * Linear GraphQL client
 */

const LINEAR_API_URL = 'https://api.linear.app/graphql';

export interface LinearIssue {
    id: string;
    identifier: string;
    title: string;
    description: string | null;
    url: string;
    priority: number; // 0 = No priority, 1 = Urgent, 2 = High, 3 = Normal, 4 = Low
    state: {
        name: string;
        type: string;
    };
    labels: {
        nodes: Array<{ name: string }>;
    };
    assignee: {
        name: string;
    } | null;
}

export interface LinearTeam {
    id: string;
    name: string;
    key: string;
}

export interface LinearProject {
    id: string;
    name: string;
}

export class LinearClient {
    private apiKey: string;

    constructor(apiKey?: string) {
        this.apiKey = apiKey || process.env.LINEAR_API_KEY || '';

        if (!this.apiKey) {
            throw new Error('LINEAR_API_KEY environment variable not set');
        }
    }

    private async query<T>(graphqlQuery: string, variables?: Record<string, unknown>): Promise<T> {
        const response = await fetch(LINEAR_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': this.apiKey,
            },
            body: JSON.stringify({
                query: graphqlQuery,
                variables,
            }),
        });

        if (!response.ok) {
            throw new Error(`Linear API error: ${response.status} ${response.statusText}`);
        }

        const json = await response.json() as { data?: T; errors?: Array<{ message: string }> };

        if (json.errors && json.errors.length > 0) {
            throw new Error(`Linear GraphQL error: ${json.errors[0].message}`);
        }

        return json.data as T;
    }

    async getTeams(): Promise<LinearTeam[]> {
        const data = await this.query<{ teams: { nodes: LinearTeam[] } }>(`
            query {
                teams {
                    nodes {
                        id
                        name
                        key
                    }
                }
            }
        `);

        return data.teams.nodes;
    }

    async getProjects(teamId: string): Promise<LinearProject[]> {
        const data = await this.query<{ team: { projects: { nodes: LinearProject[] } } }>(`
            query($teamId: String!) {
                team(id: $teamId) {
                    projects {
                        nodes {
                            id
                            name
                        }
                    }
                }
            }
        `, { teamId });

        return data.team.projects.nodes;
    }

    async getIssues(teamId: string, projectId?: string): Promise<LinearIssue[]> {
        const filter: Record<string, unknown> = {
            team: { id: { eq: teamId } },
            state: { type: { nin: ['completed', 'canceled'] } },
        };

        if (projectId) {
            filter.project = { id: { eq: projectId } };
        }

        const data = await this.query<{ issues: { nodes: LinearIssue[] } }>(`
            query($filter: IssueFilter) {
                issues(filter: $filter, first: 50) {
                    nodes {
                        id
                        identifier
                        title
                        description
                        url
                        priority
                        state {
                            name
                            type
                        }
                        labels {
                            nodes {
                                name
                            }
                        }
                        assignee {
                            name
                        }
                    }
                }
            }
        `, { filter });

        return data.issues.nodes;
    }

    async updateIssueState(issueId: string, stateId: string): Promise<void> {
        await this.query(`
            mutation($issueId: String!, $stateId: String!) {
                issueUpdate(id: $issueId, input: { stateId: $stateId }) {
                    success
                }
            }
        `, { issueId, stateId });
    }

    async addComment(issueId: string, body: string): Promise<void> {
        await this.query(`
            mutation($issueId: String!, $body: String!) {
                commentCreate(input: { issueId: $issueId, body: $body }) {
                    success
                }
            }
        `, { issueId, body });
    }

    async getWorkflowStates(teamId: string): Promise<Array<{ id: string; name: string; type: string }>> {
        const data = await this.query<{ team: { states: { nodes: Array<{ id: string; name: string; type: string }> } } }>(`
            query($teamId: String!) {
                team(id: $teamId) {
                    states {
                        nodes {
                            id
                            name
                            type
                        }
                    }
                }
            }
        `, { teamId });

        return data.team.states.nodes;
    }
}
