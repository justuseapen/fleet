import type { TaskAdapter } from './base.js';
import type { TaskSourceConfig } from '../types.js';
import { JiraAdapter } from './jira.js';
import { GitHubAdapter } from './github.js';
import { LinearAdapter } from './linear/adapter.js';

export { TaskAdapter } from './base.js';
export { JiraAdapter } from './jira.js';
export { GitHubAdapter } from './github.js';
export { LinearAdapter } from './linear/adapter.js';
export { LinearClient } from './linear/client.js';

/**
 * Factory function to create the appropriate adapter based on config
 */
export function createAdapter(config: TaskSourceConfig): TaskAdapter {
    switch (config.type) {
        case 'jira':
            return new JiraAdapter(config);
        case 'github':
            return new GitHubAdapter(config);
        case 'linear':
            return new LinearAdapter(config);
        default:
            throw new Error(`Unknown task source type: ${(config as { type: string }).type}`);
    }
}
