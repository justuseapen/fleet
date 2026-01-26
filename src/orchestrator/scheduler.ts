import type { Project, Run, Prd } from '../db/index.js';
import {
    getAllProjects,
    getRunsByStatus,
    getPrdsByStatus,
    getProjectById,
    insertRun,
    generateId,
} from '../db/index.js';
import type { ExecutionConfig } from '../types.js';
import { DeveloperAgent } from '../agents/developer.js';

interface ScheduledRun {
    project: Project;
    prd: Prd;
    run: Run;
}

/**
 * Parallel execution scheduler for Ralph loops
 */
export class Scheduler {
    private runningProjects: Set<string> = new Set();
    private maxGlobalConcurrency: number;

    constructor(maxGlobalConcurrency = 4) {
        this.maxGlobalConcurrency = maxGlobalConcurrency;
    }

    /**
     * Get number of currently running executions
     */
    getRunningCount(): number {
        return this.runningProjects.size;
    }

    /**
     * Check if a project is currently running
     */
    isProjectRunning(projectId: string): boolean {
        return this.runningProjects.has(projectId);
    }

    /**
     * Schedule approved PRDs for execution
     */
    async scheduleApproved(): Promise<ScheduledRun[]> {
        const approvedPrds = getPrdsByStatus('approved');
        const scheduled: ScheduledRun[] = [];

        for (const prd of approvedPrds) {
            // Check global concurrency
            if (this.runningProjects.size >= this.maxGlobalConcurrency) {
                break;
            }

            // Check if project already running
            if (this.runningProjects.has(prd.project_id)) {
                continue;
            }

            const project = getProjectById(prd.project_id);
            if (!project) continue;

            // Check project-level concurrency
            const executionConfig: ExecutionConfig = JSON.parse(project.execution_config);
            const projectRuns = getRunsByStatus('running').filter(r => r.project_id === project.id);
            if (projectRuns.length >= executionConfig.maxConcurrentAgents) {
                continue;
            }

            // Create run
            const runId = generateId();
            const prdJson = JSON.parse(prd.prd_json);
            const run: Run = {
                id: runId,
                prd_id: prd.id,
                project_id: project.id,
                branch: prdJson.branchName || `fleet/${runId}`,
                status: 'pending',
                iterations_planned: executionConfig.defaultIterations,
                iterations_completed: 0,
                started_at: null,
                completed_at: null,
                error: null,
                pr_url: null,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            };

            insertRun(run);
            scheduled.push({ project, prd, run });
        }

        return scheduled;
    }

    /**
     * Execute scheduled runs in parallel
     */
    async executeRuns(runs: ScheduledRun[]): Promise<Map<string, { success: boolean; error?: string }>> {
        const results = new Map<string, { success: boolean; error?: string }>();
        const promises: Promise<void>[] = [];

        for (const { project, prd, run } of runs) {
            this.runningProjects.add(project.id);

            const promise = this.executeSingleRun(project, prd, run)
                .then(result => {
                    results.set(run.id, result);
                })
                .finally(() => {
                    this.runningProjects.delete(project.id);
                });

            promises.push(promise);
        }

        await Promise.all(promises);
        return results;
    }

    private async executeSingleRun(
        project: Project,
        prd: Prd,
        run: Run
    ): Promise<{ success: boolean; error?: string }> {
        const developer = new DeveloperAgent();

        // Get task for context (may be null for proposal-based PRDs)
        const { getTaskById } = await import('../db/index.js');
        const task = prd.task_id ? getTaskById(prd.task_id) : undefined;

        const result = await developer.execute({
            project,
            task,
            prd,
            run,
            workDir: project.path,
        });

        return {
            success: result.success,
            error: result.error,
        };
    }

    /**
     * Get status of all running projects
     */
    getRunningStatus(): Array<{ projectId: string; projectName: string; runId: string }> {
        const running = getRunsByStatus('running');
        return running.map(run => {
            const project = getProjectById(run.project_id);
            return {
                projectId: run.project_id,
                projectName: project?.name || 'Unknown',
                runId: run.id,
            };
        });
    }
}
