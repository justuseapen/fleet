import {
    getRunsByStatus,
    getProjectById,
    getPrdById,
    insertHealthAlert,
    getAlertsByRun,
    generateId,
    updateRun,
    insertWorkLog,
    Run,
    HealthAlert,
} from '../db/index.js';
import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface HealthCheckResult {
    runId: string;
    projectId: string;
    projectName: string;
    status: 'healthy' | 'warning' | 'error' | 'critical';
    issues: HealthIssue[];
}

export interface HealthIssue {
    type: 'stuck' | 'crashed' | 'slow_progress' | 'error';
    severity: 'warning' | 'error' | 'critical';
    message: string;
    details?: Record<string, unknown>;
}

export interface AlertConfig {
    console: boolean;
    file: boolean;
    webhook?: string;
    stuckThresholdMinutes: number;
    warningThresholdMinutes: number;
}

const DEFAULT_ALERT_CONFIG: AlertConfig = {
    console: true,
    file: true,
    stuckThresholdMinutes: 30,
    warningThresholdMinutes: 20,
};

/**
 * Health monitoring system for Fleet agents
 */
export class HealthMonitor {
    private config: AlertConfig;
    private alertLogPath: string;

    constructor(config: Partial<AlertConfig> = {}) {
        this.config = { ...DEFAULT_ALERT_CONFIG, ...config };

        // Set up alert log file
        const fleetDir = join(homedir(), '.fleet');
        if (!existsSync(fleetDir)) {
            mkdirSync(fleetDir, { recursive: true });
        }
        this.alertLogPath = join(fleetDir, 'alerts.log');
    }

    /**
     * Check health of all running agents
     */
    checkAllAgents(): HealthCheckResult[] {
        const results: HealthCheckResult[] = [];
        const runningRuns = getRunsByStatus('running');

        for (const run of runningRuns) {
            const result = this.checkSingleRun(run);
            results.push(result);
        }

        return results;
    }

    /**
     * Check health of a single run
     */
    checkSingleRun(run: Run): HealthCheckResult {
        const project = getProjectById(run.project_id);
        const issues: HealthIssue[] = [];

        // Check for stuck agent (no progress for too long)
        if (run.started_at) {
            const startTime = new Date(run.started_at).getTime();
            const runtimeMinutes = (Date.now() - startTime) / 60000;

            // Check for stuck condition
            if (runtimeMinutes >= this.config.stuckThresholdMinutes) {
                const expectedIterations = Math.floor(runtimeMinutes / 5); // ~5 min per iteration
                if (run.iterations_completed < expectedIterations * 0.3) {
                    issues.push({
                        type: 'stuck',
                        severity: 'critical',
                        message: `Agent stuck for ${Math.floor(runtimeMinutes)} minutes with only ${run.iterations_completed}/${run.iterations_planned} iterations`,
                        details: {
                            runtimeMinutes: Math.floor(runtimeMinutes),
                            iterationsCompleted: run.iterations_completed,
                            iterationsPlanned: run.iterations_planned,
                        },
                    });
                }
            }

            // Check for warning condition (slower than expected)
            if (runtimeMinutes >= this.config.warningThresholdMinutes && issues.length === 0) {
                if (run.iterations_completed === 0) {
                    issues.push({
                        type: 'slow_progress',
                        severity: 'warning',
                        message: `No iterations completed after ${Math.floor(runtimeMinutes)} minutes`,
                        details: {
                            runtimeMinutes: Math.floor(runtimeMinutes),
                        },
                    });
                }
            }
        }

        // Determine overall status
        let status: HealthCheckResult['status'] = 'healthy';
        if (issues.some(i => i.severity === 'critical')) {
            status = 'critical';
        } else if (issues.some(i => i.severity === 'error')) {
            status = 'error';
        } else if (issues.some(i => i.severity === 'warning')) {
            status = 'warning';
        }

        return {
            runId: run.id,
            projectId: run.project_id,
            projectName: project?.name || 'Unknown',
            status,
            issues,
        };
    }

    /**
     * Detect agents that have crashed or exited unexpectedly
     * This checks for runs marked as 'running' but haven't made progress recently
     */
    detectCrashedAgents(): HealthCheckResult[] {
        const results: HealthCheckResult[] = [];
        const runningRuns = getRunsByStatus('running');

        for (const run of runningRuns) {
            const project = getProjectById(run.project_id);

            // Check if run has been "running" but updated_at is stale (>10 minutes)
            if (run.updated_at) {
                const lastUpdate = new Date(run.updated_at).getTime();
                const staleMinutes = (Date.now() - lastUpdate) / 60000;

                // If no update in 10+ minutes and we have no progress, likely crashed
                if (staleMinutes > 10 && run.iterations_completed === 0) {
                    results.push({
                        runId: run.id,
                        projectId: run.project_id,
                        projectName: project?.name || 'Unknown',
                        status: 'error',
                        issues: [{
                            type: 'crashed',
                            severity: 'error',
                            message: `Agent may have crashed - no updates for ${Math.floor(staleMinutes)} minutes`,
                            details: {
                                lastUpdate: run.updated_at,
                                staleMinutes: Math.floor(staleMinutes),
                            },
                        }],
                    });
                }
            }
        }

        return results;
    }

    /**
     * Run health check and generate alerts for any issues found
     */
    async runHealthCheck(): Promise<{
        checked: number;
        healthy: number;
        warnings: number;
        errors: number;
        alerts: HealthAlert[];
    }> {
        const healthResults = this.checkAllAgents();
        const crashedResults = this.detectCrashedAgents();
        const allResults = [...healthResults, ...crashedResults];

        const alerts: HealthAlert[] = [];
        let healthy = 0;
        let warnings = 0;
        let errors = 0;

        for (const result of allResults) {
            if (result.status === 'healthy') {
                healthy++;
                continue;
            }

            if (result.status === 'warning') {
                warnings++;
            } else {
                errors++;
            }

            // Create alerts for each issue
            for (const issue of result.issues) {
                // Check if we already have a recent alert for this run/type
                const existingAlerts = getAlertsByRun(result.runId);
                const recentSameAlert = existingAlerts.find(a =>
                    a.alert_type === issue.type &&
                    new Date(a.created_at).getTime() > Date.now() - 5 * 60 * 1000 // Within last 5 minutes
                );

                if (recentSameAlert) {
                    // Don't create duplicate alert
                    continue;
                }

                const alert: Omit<HealthAlert, 'created_at'> = {
                    id: generateId(),
                    run_id: result.runId,
                    project_id: result.projectId,
                    alert_type: issue.type,
                    severity: issue.severity,
                    message: issue.message,
                    context: issue.details ? JSON.stringify(issue.details) : null,
                    acknowledged: 0,
                    acknowledged_at: null,
                };

                // Store alert in database
                insertHealthAlert(alert);
                alerts.push({ ...alert, created_at: new Date().toISOString() });

                // Send alert via configured channels
                await this.sendAlert(alert, result.projectName);

                // Log to work log
                insertWorkLog({
                    id: generateId(),
                    run_id: result.runId,
                    project_id: result.projectId,
                    event_type: 'failed',
                    summary: `Health alert: ${issue.message}`,
                    details: JSON.stringify(issue.details),
                });
            }
        }

        return {
            checked: allResults.length,
            healthy,
            warnings,
            errors,
            alerts,
        };
    }

    /**
     * Send alert via configured channels
     */
    private async sendAlert(alert: Omit<HealthAlert, 'created_at'>, projectName: string): Promise<void> {
        const timestamp = new Date().toISOString();
        const severityEmoji = {
            warning: '⚠️',
            error: '❌',
            critical: '🚨',
        }[alert.severity];

        const message = `${severityEmoji} [${alert.severity.toUpperCase()}] ${projectName}: ${alert.message}`;

        // Console output
        if (this.config.console) {
            console.log(`[${timestamp}] ${message}`);
        }

        // File logging
        if (this.config.file) {
            const logEntry = JSON.stringify({
                timestamp,
                severity: alert.severity,
                type: alert.alert_type,
                project: projectName,
                runId: alert.run_id,
                message: alert.message,
                context: alert.context ? JSON.parse(alert.context) : null,
            }) + '\n';

            appendFileSync(this.alertLogPath, logEntry);
        }

        // Webhook notification
        if (this.config.webhook) {
            try {
                await fetch(this.config.webhook, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        text: message,
                        severity: alert.severity,
                        type: alert.alert_type,
                        project: projectName,
                        runId: alert.run_id,
                        context: alert.context ? JSON.parse(alert.context) : null,
                    }),
                });
            } catch (error) {
                console.error(`Failed to send webhook alert: ${error}`);
            }
        }
    }

    /**
     * Mark a failed run based on health check
     */
    markRunAsFailed(runId: string, error: string): void {
        updateRun(runId, {
            status: 'failed',
            completed_at: new Date().toISOString(),
            error,
        });
    }
}

/**
 * Start continuous health monitoring
 */
export function startHealthMonitoring(
    intervalMs = 60000, // Check every minute by default
    config?: Partial<AlertConfig>
): { stop: () => void } {
    const monitor = new HealthMonitor(config);

    const timer = setInterval(async () => {
        try {
            await monitor.runHealthCheck();
        } catch (error) {
            console.error('Health check failed:', error);
        }
    }, intervalMs);

    return {
        stop: () => clearInterval(timer),
    };
}
