import {
    getAllProjects,
    getTasksByProject,
    getTasksByStatus,
    getProjectById,
    upsertTask,
    generateId,
    type Project,
    type Task,
} from '../db/index.js';
import { createAdapter } from '../adapters/index.js';
import { PlannerAgent } from '../agents/planner.js';
import { Scheduler } from './scheduler.js';
import type { TaskSourceConfig, FleetGlobalConfig } from '../types.js';

export { Scheduler } from './scheduler.js';

/**
 * Main Fleet orchestrator
 */
export class Orchestrator {
    private scheduler: Scheduler;
    private config: FleetGlobalConfig;

    constructor(config: FleetGlobalConfig) {
        this.config = config;
        this.scheduler = new Scheduler(config.maxGlobalConcurrency);
    }

    /**
     * Sync tasks from all configured projects
     */
    async syncAllProjects(): Promise<Map<string, { synced: number; errors: string[] }>> {
        const projects = getAllProjects();
        const results = new Map<string, { synced: number; errors: string[] }>();

        for (const project of projects) {
            const result = await this.syncProject(project);
            results.set(project.id, result);
        }

        return results;
    }

    /**
     * Sync tasks from a single project
     */
    async syncProject(project: Project): Promise<{ synced: number; errors: string[] }> {
        const errors: string[] = [];
        let synced = 0;

        try {
            const taskSourceConfig: TaskSourceConfig = JSON.parse(project.task_source_config);
            const adapter = createAdapter(taskSourceConfig);

            const tasks = await adapter.fetchTasks();

            for (const task of tasks) {
                try {
                    upsertTask({
                        id: generateId(),
                        project_id: project.id,
                        external_id: task.externalId,
                        external_url: task.externalUrl,
                        title: task.title,
                        description: task.description,
                        task_type: task.taskType,
                        priority: task.priority,
                        status: 'backlog',
                        labels: JSON.stringify(task.labels),
                        assignee: task.assignee,
                        synced_at: new Date().toISOString(),
                    });
                    synced++;
                } catch (error) {
                    errors.push(`Failed to upsert task ${task.externalId}: ${error}`);
                }
            }
        } catch (error) {
            errors.push(`Failed to sync project ${project.name}: ${error}`);
        }

        return { synced, errors };
    }

    /**
     * Generate PRDs for high-priority backlog tasks
     */
    async planBacklogTasks(maxTasks = 5): Promise<{ planned: string[]; errors: string[] }> {
        const planner = new PlannerAgent();
        const planned: string[] = [];
        const errors: string[] = [];

        // Get backlog tasks sorted by priority
        const backlogTasks = getTasksByStatus('backlog')
            .filter(t => t.priority === 'critical' || t.priority === 'high')
            .slice(0, maxTasks);

        for (const task of backlogTasks) {
            const project = getProjectById(task.project_id);
            if (!project) continue;

            try {
                const result = await planner.execute({
                    project,
                    task,
                    workDir: project.path,
                });

                if (result.success) {
                    planned.push(task.external_id);
                } else {
                    errors.push(`Failed to plan ${task.external_id}: ${result.error}`);
                }
            } catch (error) {
                errors.push(`Exception planning ${task.external_id}: ${error}`);
            }
        }

        return { planned, errors };
    }

    /**
     * Execute approved PRDs
     */
    async executeApproved(): Promise<{
        started: number;
        results: Map<string, { success: boolean; error?: string }>;
    }> {
        const scheduled = await this.scheduler.scheduleApproved();
        const results = await this.scheduler.executeRuns(scheduled);

        return {
            started: scheduled.length,
            results,
        };
    }

    /**
     * Get scheduler for status checks
     */
    getScheduler(): Scheduler {
        return this.scheduler;
    }
}
