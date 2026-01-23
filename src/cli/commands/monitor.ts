import { Command } from 'commander';
import chalk from 'chalk';
import {
    getRunsByStatus,
    getProjectById,
    getPrdById,
    getAllProjects,
    getWorkLogByProject,
    Run,
} from '../../db/index.js';

interface AgentStatus {
    runId: string;
    projectId: string;
    projectName: string;
    taskTitle: string;
    branch: string;
    phase: 'pending' | 'running' | 'completed' | 'failed';
    progress: string;
    runtime: string;
    health: 'healthy' | 'warning' | 'error';
    healthReason?: string;
}

/**
 * Calculate runtime duration from start time
 */
function calculateRuntime(startedAt: string | null): string {
    if (!startedAt) return '-';
    const start = new Date(startedAt).getTime();
    const now = Date.now();
    const diffMs = now - start;
    const minutes = Math.floor(diffMs / 60000);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
        return `${hours}h ${minutes % 60}m`;
    }
    return `${minutes}m`;
}

/**
 * Determine health status based on runtime and progress
 */
function determineHealth(run: Run): { status: 'healthy' | 'warning' | 'error'; reason?: string } {
    if (run.status === 'failed') {
        return { status: 'error', reason: run.error || 'Execution failed' };
    }

    if (run.status !== 'running') {
        return { status: 'healthy' };
    }

    // Check if stuck (>30 minutes without progress)
    if (run.started_at) {
        const startTime = new Date(run.started_at).getTime();
        const runtimeMs = Date.now() - startTime;
        const runtimeMinutes = runtimeMs / 60000;

        // Warning if running > 20 minutes with no iterations
        if (runtimeMinutes > 20 && run.iterations_completed === 0) {
            return { status: 'warning', reason: 'No progress detected' };
        }

        // Error if running > 30 minutes with minimal progress
        if (runtimeMinutes > 30) {
            const expectedProgress = runtimeMinutes / 5; // ~5 min per iteration
            if (run.iterations_completed < expectedProgress * 0.5) {
                return { status: 'error', reason: 'Potentially stuck' };
            }
            return { status: 'warning', reason: 'Long running' };
        }
    }

    return { status: 'healthy' };
}

/**
 * Get colored status indicator
 */
function getStatusIndicator(health: 'healthy' | 'warning' | 'error'): string {
    switch (health) {
        case 'healthy':
            return chalk.green('●');
        case 'warning':
            return chalk.yellow('●');
        case 'error':
            return chalk.red('●');
    }
}

/**
 * Get colored phase text
 */
function getPhaseText(phase: string): string {
    switch (phase) {
        case 'running':
            return chalk.cyan(phase);
        case 'pending':
            return chalk.gray(phase);
        case 'completed':
            return chalk.green(phase);
        case 'failed':
            return chalk.red(phase);
        default:
            return phase;
    }
}

/**
 * Gather status data for all agents
 */
function gatherAgentStatus(): AgentStatus[] {
    const statuses: AgentStatus[] = [];

    // Get running and pending runs
    const runningRuns = getRunsByStatus('running');
    const pendingRuns = getRunsByStatus('pending');

    for (const run of [...runningRuns, ...pendingRuns]) {
        const project = getProjectById(run.project_id);
        const prd = getPrdById(run.prd_id);

        let taskTitle = 'Unknown task';
        if (prd) {
            try {
                const prdJson = JSON.parse(prd.prd_json);
                taskTitle = prdJson.description || prdJson.project || 'PRD execution';
            } catch {
                taskTitle = 'PRD execution';
            }
        }

        const health = determineHealth(run);

        statuses.push({
            runId: run.id.slice(0, 8),
            projectId: run.project_id.slice(0, 8),
            projectName: project?.name || 'Unknown',
            taskTitle: taskTitle.length > 40 ? taskTitle.slice(0, 37) + '...' : taskTitle,
            branch: run.branch,
            phase: run.status,
            progress: `${run.iterations_completed}/${run.iterations_planned}`,
            runtime: calculateRuntime(run.started_at),
            health: health.status,
            healthReason: health.reason,
        });
    }

    // Also get recently failed runs (last hour)
    const failedRuns = getRunsByStatus('failed');
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const recentFailed = failedRuns.filter(r => r.updated_at && r.updated_at > oneHourAgo);

    for (const run of recentFailed.slice(0, 5)) {
        const project = getProjectById(run.project_id);
        const prd = getPrdById(run.prd_id);

        let taskTitle = 'Unknown task';
        if (prd) {
            try {
                const prdJson = JSON.parse(prd.prd_json);
                taskTitle = prdJson.description || prdJson.project || 'PRD execution';
            } catch {
                taskTitle = 'PRD execution';
            }
        }

        statuses.push({
            runId: run.id.slice(0, 8),
            projectId: run.project_id.slice(0, 8),
            projectName: project?.name || 'Unknown',
            taskTitle: taskTitle.length > 40 ? taskTitle.slice(0, 37) + '...' : taskTitle,
            branch: run.branch,
            phase: 'failed',
            progress: `${run.iterations_completed}/${run.iterations_planned}`,
            runtime: calculateRuntime(run.started_at),
            health: 'error',
            healthReason: run.error || 'Execution failed',
        });
    }

    return statuses;
}

/**
 * Render the dashboard
 */
function renderDashboard(statuses: AgentStatus[]): string {
    const lines: string[] = [];
    const timestamp = new Date().toLocaleTimeString();

    lines.push('');
    lines.push(chalk.bold(`Fleet Agent Monitor`) + chalk.gray(` (${timestamp})`));
    lines.push(chalk.gray('─'.repeat(80)));

    if (statuses.length === 0) {
        lines.push('');
        lines.push(chalk.gray('  No agents currently running or pending.'));
        lines.push('');
        lines.push(chalk.gray('  Run `fleet run` to start executing approved PRDs.'));
        lines.push('');
    } else {
        // Header
        lines.push('');
        lines.push(
            chalk.gray('  ') +
            chalk.bold.white('Status'.padEnd(8)) +
            chalk.bold.white('Agent ID'.padEnd(10)) +
            chalk.bold.white('Project'.padEnd(15)) +
            chalk.bold.white('Phase'.padEnd(12)) +
            chalk.bold.white('Progress'.padEnd(10)) +
            chalk.bold.white('Runtime'.padEnd(10)) +
            chalk.bold.white('Task')
        );
        lines.push(chalk.gray('  ' + '─'.repeat(78)));

        // Rows
        for (const status of statuses) {
            const indicator = getStatusIndicator(status.health);
            const phaseText = getPhaseText(status.phase);

            let row =
                `  ${indicator} ` +
                status.runId.padEnd(10) +
                status.projectName.slice(0, 13).padEnd(15) +
                phaseText.padEnd(12 + (phaseText.length - status.phase.length)) +
                status.progress.padEnd(10) +
                status.runtime.padEnd(10) +
                status.taskTitle;

            lines.push(row);

            // Show health reason if not healthy
            if (status.healthReason) {
                lines.push(chalk.gray(`       └─ ${status.healthReason}`));
            }
        }
    }

    lines.push('');
    lines.push(chalk.gray('─'.repeat(80)));

    // Summary
    const running = statuses.filter(s => s.phase === 'running').length;
    const pending = statuses.filter(s => s.phase === 'pending').length;
    const failed = statuses.filter(s => s.phase === 'failed').length;
    const warnings = statuses.filter(s => s.health === 'warning').length;
    const errors = statuses.filter(s => s.health === 'error').length;

    const summaryParts = [];
    if (running > 0) summaryParts.push(chalk.cyan(`${running} running`));
    if (pending > 0) summaryParts.push(chalk.gray(`${pending} pending`));
    if (failed > 0) summaryParts.push(chalk.red(`${failed} failed`));
    if (warnings > 0) summaryParts.push(chalk.yellow(`${warnings} warnings`));
    if (errors > 0) summaryParts.push(chalk.red(`${errors} errors`));

    if (summaryParts.length > 0) {
        lines.push(chalk.gray('  Summary: ') + summaryParts.join(chalk.gray(' | ')));
    }

    lines.push('');
    lines.push(chalk.gray('  Legend: ') +
        chalk.green('●') + chalk.gray(' healthy  ') +
        chalk.yellow('●') + chalk.gray(' warning  ') +
        chalk.red('●') + chalk.gray(' error'));
    lines.push('');

    return lines.join('\n');
}

/**
 * Clear screen and move cursor to top
 */
function clearScreen(): void {
    process.stdout.write('\x1B[2J\x1B[0f');
}

export const monitorCommand = new Command('monitor')
    .description('Real-time dashboard showing status of all running agents')
    .option('--json', 'Output as JSON (single snapshot)')
    .option('--no-watch', 'Show status once without live updates')
    .option('-i, --interval <seconds>', 'Refresh interval in seconds', '5')
    .action(async (options) => {
        const interval = parseInt(options.interval, 10) * 1000;

        if (options.json) {
            // JSON output - single snapshot
            const statuses = gatherAgentStatus();
            console.log(JSON.stringify(statuses, null, 2));
            return;
        }

        if (!options.watch) {
            // Single snapshot
            const statuses = gatherAgentStatus();
            console.log(renderDashboard(statuses));
            return;
        }

        // Live watch mode
        console.log(chalk.gray('Starting live monitor (Ctrl+C to exit)...'));

        const updateDisplay = () => {
            clearScreen();
            const statuses = gatherAgentStatus();
            console.log(renderDashboard(statuses));
            console.log(chalk.gray(`  Auto-refresh every ${options.interval}s (Ctrl+C to exit)`));
        };

        // Initial display
        updateDisplay();

        // Set up refresh interval
        const timer = setInterval(updateDisplay, interval);

        // Handle graceful shutdown
        process.on('SIGINT', () => {
            clearInterval(timer);
            console.log(chalk.gray('\n  Monitor stopped.'));
            process.exit(0);
        });

        // Keep process alive
        await new Promise(() => {});
    });
