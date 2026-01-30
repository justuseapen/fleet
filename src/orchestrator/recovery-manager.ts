import {
    getRunsByStatus,
    getRunById,
    updateRun,
    getProjectById,
    getPrdById,
    insertWorkLog,
    generateId,
} from '../db/index.js';
import type { Run } from '../db/index.js';
import { logEvent } from '../logging/index.js';

const MAX_RETRY_COUNT = 3;
const PROGRESS_STALE_MINUTES = 15;
const BACKOFF_BASE_MINUTES = 5;

export interface RecoveryAttempt {
    runId: string;
    projectId: string;
    reason: string;
    action: 'marked_failed' | 'will_retry';
    retryCount: number;
}

/**
 * Detects stuck runs using progress-based timeouts and manages recovery.
 *
 * A run is considered stuck when:
 * - It has status 'running'
 * - Its last_progress_at is older than PROGRESS_STALE_MINUTES
 *
 * Recovery actions:
 * - If retry_count < MAX_RETRY_COUNT: mark as failed (the scheduler can re-queue)
 * - If retry_count >= MAX_RETRY_COUNT: mark as permanently failed
 */
export class RecoveryManager {
    /**
     * Check all running runs for staleness and attempt recovery.
     */
    async checkAndRecover(): Promise<RecoveryAttempt[]> {
        const runningRuns = getRunsByStatus('running');
        const attempts: RecoveryAttempt[] = [];

        for (const run of runningRuns) {
            const staleInfo = this.isStale(run);
            if (staleInfo) {
                const attempt = this.handleStaleRun(run, staleInfo.reason);
                attempts.push(attempt);
            }
        }

        return attempts;
    }

    /**
     * Check if a run is stale based on progress timestamps.
     */
    private isStale(run: Run): { reason: string } | null {
        const now = Date.now();

        // Use last_progress_at if available, otherwise fall back to started_at
        const lastActivity = run.last_progress_at || run.started_at;
        if (!lastActivity) {
            return null;
        }

        const lastActivityTime = new Date(lastActivity).getTime();
        const staleDuration = now - lastActivityTime;
        const staleThresholdMs = PROGRESS_STALE_MINUTES * 60 * 1000;

        // Apply backoff: increase threshold based on retry count
        const backoffMs = run.retry_count * BACKOFF_BASE_MINUTES * 60 * 1000;
        const effectiveThreshold = staleThresholdMs + backoffMs;

        if (staleDuration > effectiveThreshold) {
            const staleMinutes = Math.round(staleDuration / 60000);
            return {
                reason: `No progress for ${staleMinutes} minutes (threshold: ${Math.round(effectiveThreshold / 60000)} min, retries: ${run.retry_count})`,
            };
        }

        return null;
    }

    /**
     * Handle a stale run: mark as failed with appropriate messaging.
     */
    private handleStaleRun(run: Run, reason: string): RecoveryAttempt {
        const canRetry = run.retry_count < MAX_RETRY_COUNT;

        logEvent({
            level: canRetry ? 'warn' : 'error',
            runId: run.id,
            projectId: run.project_id,
            message: `Stale run detected: ${reason}`,
            details: {
                retryCount: run.retry_count,
                maxRetries: MAX_RETRY_COUNT,
                canRetry,
                lastProgressAt: run.last_progress_at,
                startedAt: run.started_at,
            },
        });

        const errorMessage = canRetry
            ? `Stale run detected (${reason}). Retry ${run.retry_count + 1}/${MAX_RETRY_COUNT} available.`
            : `Stale run detected (${reason}). Max retries (${MAX_RETRY_COUNT}) exhausted.`;

        updateRun(run.id, {
            status: 'failed',
            completed_at: new Date().toISOString(),
            error: errorMessage,
            retry_count: run.retry_count + 1,
        });

        insertWorkLog({
            id: generateId(),
            run_id: run.id,
            project_id: run.project_id,
            event_type: 'failed',
            summary: `Recovery: ${errorMessage}`,
            details: JSON.stringify({ reason, retryCount: run.retry_count + 1, canRetry }),
        });

        return {
            runId: run.id,
            projectId: run.project_id,
            reason,
            action: canRetry ? 'will_retry' : 'marked_failed',
            retryCount: run.retry_count + 1,
        };
    }

    /**
     * Get runs that are eligible for retry (failed with retry_count < max).
     */
    getRetryableRuns(): Run[] {
        const failedRuns = getRunsByStatus('failed');
        return failedRuns.filter(run =>
            run.retry_count > 0 &&
            run.retry_count < MAX_RETRY_COUNT &&
            run.error?.includes('Stale run detected')
        );
    }
}
