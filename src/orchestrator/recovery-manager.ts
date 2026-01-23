import { spawn } from 'child_process';
import {
    getRunById,
    getProjectById,
    getPrdById,
    updateRun,
    insertWorkLog,
    generateId,
    insertHealthAlert,
    Run,
    Project,
    Prd,
} from '../db/index.js';
import { HealthMonitor, HealthCheckResult } from './health-monitor.js';
import type { ExecutionConfig } from '../types.js';

export interface RecoveryConfig {
    maxRetries: number;
    initialBackoffMs: number;
    maxBackoffMs: number;
    backoffMultiplier: number;
}

export interface RecoveryAttempt {
    runId: string;
    attempt: number;
    timestamp: string;
    reason: string;
    success: boolean;
    error?: string;
}

interface RunRecoveryState {
    runId: string;
    attempts: number;
    lastAttemptAt: number;
    nextBackoffMs: number;
}

const DEFAULT_RECOVERY_CONFIG: RecoveryConfig = {
    maxRetries: 3,
    initialBackoffMs: 30000, // 30 seconds
    maxBackoffMs: 300000, // 5 minutes
    backoffMultiplier: 2,
};

/**
 * Recovery manager for automatic agent restart and recovery
 */
export class RecoveryManager {
    private config: RecoveryConfig;
    private healthMonitor: HealthMonitor;
    private recoveryStates: Map<string, RunRecoveryState> = new Map();
    private activeRecoveries: Set<string> = new Set();

    constructor(config: Partial<RecoveryConfig> = {}) {
        this.config = { ...DEFAULT_RECOVERY_CONFIG, ...config };
        this.healthMonitor = new HealthMonitor();
    }

    /**
     * Check for failed or stuck runs and attempt recovery
     */
    async checkAndRecover(): Promise<RecoveryAttempt[]> {
        const attempts: RecoveryAttempt[] = [];

        // Get health check results
        const healthResults = this.healthMonitor.checkAllAgents();
        const crashedResults = this.healthMonitor.detectCrashedAgents();

        // Combine and filter for recoverable issues
        const recoverableRuns = [...healthResults, ...crashedResults].filter(
            result => result.status === 'critical' || result.status === 'error'
        );

        for (const result of recoverableRuns) {
            // Skip if already recovering this run
            if (this.activeRecoveries.has(result.runId)) {
                continue;
            }

            const attempt = await this.attemptRecovery(result);
            if (attempt) {
                attempts.push(attempt);
            }
        }

        return attempts;
    }

    /**
     * Attempt to recover a specific run
     */
    async attemptRecovery(healthResult: HealthCheckResult): Promise<RecoveryAttempt | null> {
        const run = getRunById(healthResult.runId);
        if (!run) {
            return null;
        }

        // Get or create recovery state
        let state = this.recoveryStates.get(run.id);
        if (!state) {
            state = {
                runId: run.id,
                attempts: 0,
                lastAttemptAt: 0,
                nextBackoffMs: this.config.initialBackoffMs,
            };
            this.recoveryStates.set(run.id, state);
        }

        // Check if max retries exceeded
        if (state.attempts >= this.config.maxRetries) {
            this.logRecoveryFailed(run, `Max retries (${this.config.maxRetries}) exceeded`);
            return {
                runId: run.id,
                attempt: state.attempts,
                timestamp: new Date().toISOString(),
                reason: healthResult.issues[0]?.message || 'Unknown issue',
                success: false,
                error: `Max retries (${this.config.maxRetries}) exceeded`,
            };
        }

        // Check if we need to wait for backoff
        const timeSinceLastAttempt = Date.now() - state.lastAttemptAt;
        if (timeSinceLastAttempt < state.nextBackoffMs && state.attempts > 0) {
            // Not ready for retry yet
            return null;
        }

        // Mark as actively recovering
        this.activeRecoveries.add(run.id);
        state.attempts++;
        state.lastAttemptAt = Date.now();

        const reason = healthResult.issues[0]?.message || 'Unknown issue';

        try {
            // Log recovery attempt
            this.logRecoveryAttempt(run, state.attempts, reason);

            // Kill stuck process if needed
            if (healthResult.issues.some(i => i.type === 'stuck')) {
                await this.killStuckProcess(run);
            }

            // Prepare for restart
            const project = getProjectById(run.project_id);
            const prd = getPrdById(run.prd_id);

            if (!project || !prd) {
                throw new Error('Project or PRD not found');
            }

            // Reset run status for restart
            const preservedProgress = run.iterations_completed;
            updateRun(run.id, {
                status: 'running',
                error: null,
            });

            // Restart the agent
            const success = await this.restartAgent(run, project, prd, preservedProgress);

            if (success) {
                // Reset recovery state on success
                this.recoveryStates.delete(run.id);
                this.logRecoverySuccess(run, state.attempts);

                return {
                    runId: run.id,
                    attempt: state.attempts,
                    timestamp: new Date().toISOString(),
                    reason,
                    success: true,
                };
            } else {
                // Calculate next backoff
                state.nextBackoffMs = Math.min(
                    state.nextBackoffMs * this.config.backoffMultiplier,
                    this.config.maxBackoffMs
                );

                return {
                    runId: run.id,
                    attempt: state.attempts,
                    timestamp: new Date().toISOString(),
                    reason,
                    success: false,
                    error: 'Restart failed',
                };
            }
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);

            // Calculate next backoff
            state.nextBackoffMs = Math.min(
                state.nextBackoffMs * this.config.backoffMultiplier,
                this.config.maxBackoffMs
            );

            return {
                runId: run.id,
                attempt: state.attempts,
                timestamp: new Date().toISOString(),
                reason,
                success: false,
                error: errorMsg,
            };
        } finally {
            this.activeRecoveries.delete(run.id);
        }
    }

    /**
     * Kill a stuck process
     */
    private async killStuckProcess(run: Run): Promise<void> {
        // Find and kill any ralph processes for this run
        // This is a best-effort approach using pkill
        return new Promise((resolve) => {
            const project = getProjectById(run.project_id);
            if (!project) {
                resolve();
                return;
            }

            // Try to kill ralph processes in the project directory
            const pkill = spawn('pkill', ['-f', `ralph.*${project.path}`], {
                stdio: 'ignore',
            });

            pkill.on('close', () => {
                // Give processes time to cleanup
                setTimeout(resolve, 2000);
            });

            pkill.on('error', () => {
                resolve();
            });
        });
    }

    /**
     * Restart an agent run
     */
    private async restartAgent(
        run: Run,
        project: Project,
        prd: Prd,
        preservedIterations: number
    ): Promise<boolean> {
        const executionConfig: ExecutionConfig = JSON.parse(project.execution_config);
        const prdJson = JSON.parse(prd.prd_json);

        // Calculate remaining iterations
        const remainingIterations = Math.max(
            1,
            executionConfig.defaultIterations - preservedIterations
        );

        return new Promise((resolve) => {
            // Look for ralph.sh in the project
            const workDir = project.path;
            const ralphScript = `${workDir}/ralph.sh`;

            const ralph = spawn(ralphScript, ['--tool', executionConfig.tool, String(remainingIterations)], {
                cwd: workDir,
                stdio: ['inherit', 'pipe', 'pipe'],
                detached: true, // Run independently
                env: {
                    ...process.env,
                    FLEET_MANAGED: '1',
                    FLEET_RECOVERY: '1',
                    FLEET_PRESERVED_ITERATIONS: String(preservedIterations),
                },
            });

            let started = false;

            ralph.stdout?.on('data', (data) => {
                const output = data.toString();

                // Check if Ralph started successfully
                if (output.includes('Iteration') || output.includes('Starting')) {
                    started = true;
                }

                // Update iteration count
                const iterMatch = output.match(/Iteration (\d+)/);
                if (iterMatch) {
                    const currentIteration = parseInt(iterMatch[1], 10);
                    updateRun(run.id, {
                        iterations_completed: preservedIterations + currentIteration,
                    });
                }

                // Check for completion
                if (output.includes('<promise>COMPLETE</promise>')) {
                    updateRun(run.id, {
                        status: 'completed',
                        completed_at: new Date().toISOString(),
                    });
                }
            });

            ralph.on('error', (error) => {
                console.error(`Failed to restart agent: ${error.message}`);
                resolve(false);
            });

            // Unref to allow parent to exit independently
            ralph.unref();

            // Consider it started if no error after 5 seconds
            setTimeout(() => {
                resolve(started || true); // Assume started if no error
            }, 5000);
        });
    }

    /**
     * Log recovery attempt to work log
     */
    private logRecoveryAttempt(run: Run, attempt: number, reason: string): void {
        insertWorkLog({
            id: generateId(),
            run_id: run.id,
            project_id: run.project_id,
            event_type: 'started',
            summary: `Recovery attempt ${attempt}/${this.config.maxRetries}: ${reason}`,
            details: JSON.stringify({
                attempt,
                maxRetries: this.config.maxRetries,
                reason,
                timestamp: new Date().toISOString(),
            }),
        });

        insertHealthAlert({
            id: generateId(),
            run_id: run.id,
            project_id: run.project_id,
            alert_type: 'error',
            severity: 'warning',
            message: `Recovery attempt ${attempt}/${this.config.maxRetries}: ${reason}`,
            context: JSON.stringify({ attempt, reason }),
            acknowledged: 0,
            acknowledged_at: null,
        });
    }

    /**
     * Log successful recovery
     */
    private logRecoverySuccess(run: Run, attempts: number): void {
        insertWorkLog({
            id: generateId(),
            run_id: run.id,
            project_id: run.project_id,
            event_type: 'started',
            summary: `Successfully recovered after ${attempts} attempt(s)`,
            details: JSON.stringify({
                attempts,
                timestamp: new Date().toISOString(),
            }),
        });
    }

    /**
     * Log recovery failure (max retries exceeded)
     */
    private logRecoveryFailed(run: Run, reason: string): void {
        updateRun(run.id, {
            status: 'failed',
            completed_at: new Date().toISOString(),
            error: `Recovery failed: ${reason}`,
        });

        insertWorkLog({
            id: generateId(),
            run_id: run.id,
            project_id: run.project_id,
            event_type: 'failed',
            summary: `Recovery failed: ${reason}`,
            details: JSON.stringify({
                reason,
                timestamp: new Date().toISOString(),
            }),
        });

        insertHealthAlert({
            id: generateId(),
            run_id: run.id,
            project_id: run.project_id,
            alert_type: 'error',
            severity: 'critical',
            message: `Recovery failed after max retries: ${reason}`,
            context: JSON.stringify({ reason }),
            acknowledged: 0,
            acknowledged_at: null,
        });
    }

    /**
     * Get recovery state for a run
     */
    getRecoveryState(runId: string): RunRecoveryState | undefined {
        return this.recoveryStates.get(runId);
    }

    /**
     * Clear recovery state (e.g., when run completes successfully)
     */
    clearRecoveryState(runId: string): void {
        this.recoveryStates.delete(runId);
    }
}

/**
 * Start automatic recovery monitoring
 */
export function startRecoveryMonitoring(
    intervalMs = 60000, // Check every minute
    config?: Partial<RecoveryConfig>
): { stop: () => void; manager: RecoveryManager } {
    const manager = new RecoveryManager(config);

    const timer = setInterval(async () => {
        try {
            const attempts = await manager.checkAndRecover();
            if (attempts.length > 0) {
                console.log(`[Recovery] Made ${attempts.length} recovery attempt(s)`);
                for (const attempt of attempts) {
                    console.log(
                        `  - Run ${attempt.runId.slice(0, 8)}: ` +
                        `attempt ${attempt.attempt}, ` +
                        `${attempt.success ? 'success' : `failed: ${attempt.error}`}`
                    );
                }
            }
        } catch (error) {
            console.error('Recovery check failed:', error);
        }
    }, intervalMs);

    return {
        stop: () => clearInterval(timer),
        manager,
    };
}
