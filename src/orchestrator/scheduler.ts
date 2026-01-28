import type { Project, Run, Prd } from '../db/index.js';
import {
    getAllProjects,
    getRunsByStatus,
    getPrdsByStatus,
    getProjectById,
    insertRun,
    updateRun,
    generateId,
} from '../db/index.js';
import type { ExecutionConfig } from '../types.js';
import { DeveloperAgent } from '../agents/developer.js';
import { createWorktree, removeWorktree } from '../git/worktree.js';

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
        const scheduledProjects = new Set<string>();

        for (const prd of approvedPrds) {
            // Check global concurrency
            if (this.runningProjects.size + scheduledProjects.size >= this.maxGlobalConcurrency) {
                break;
            }

            // Check if project already running or already scheduled in this batch
            // (can't run multiple PRDs on same project - they'd conflict on git branches)
            if (this.runningProjects.has(prd.project_id) || scheduledProjects.has(prd.project_id)) {
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
                worktree_path: null,
                restart_count: 0,
                last_restart_at: null,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            };

            insertRun(run);
            scheduled.push({ project, prd, run });
            scheduledProjects.add(project.id);
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

        // Create an isolated worktree for this run
        const worktreeInfo = await createWorktree(
            project.path,
            project.id,
            run.id,
            run.branch
        );

        // Record worktree path on the run for crash recovery
        updateRun(run.id, { worktree_path: worktreeInfo.path });

        try {
            const result = await developer.execute({
                project,
                task,
                prd,
                run,
                workDir: worktreeInfo.path,
            });

            return {
                success: result.success,
                error: result.error,
            };
        } finally {
            // Always clean up the worktree after execution
            try {
                await removeWorktree(project.path, worktreeInfo.path);
                updateRun(run.id, { worktree_path: null });
            } catch {
                // Best-effort cleanup; orphans handled by `fleet cleanup --worktrees`
            }
        }
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
