import type { UnifiedTask, TaskSourceConfig } from '../types.js';

export interface TaskAdapter {
    /**
     * Fetch tasks from the external source
     */
    fetchTasks(): Promise<UnifiedTask[]>;

    /**
     * Update task status in the external source
     */
    updateTaskStatus?(externalId: string, status: string): Promise<void>;

    /**
     * Add a comment to a task
     */
    addComment?(externalId: string, comment: string): Promise<void>;
}

export interface AdapterFactory {
    create(config: TaskSourceConfig): TaskAdapter;
}
