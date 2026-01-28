import chalk from 'chalk';
import {
    getAllProjects,
    getWorkLogSince,
    getPrdsByStatus,
    getRunsByStatus,
    getProjectById,
    getTaskById,
    getTasksByProject,
    getProposalsByStatus,
    type WorkLog,
    type Prd,
    type Run,
    type Proposal,
} from '../db/index.js';
import { getProjectsNeedingIdeas, type BacklogHealth } from '../orchestrator/backlog-analyzer.js';

interface BriefingData {
    completedOvernight: Array<{
        project: string;
        summary: string;
        prUrl?: string;
    }>;
    pendingApprovals: Array<{
        project: string;
        task: string;
        riskLevel: 'LOW' | 'MED' | 'HIGH';
        riskScore: number;
    }>;
    blockedOrFailed: Array<{
        project: string;
        summary: string;
        error?: string;
    }>;
    runningNow: Array<{
        project: string;
        branch: string;
        iterations: string;
    }>;
    suggestedPriorities: Array<{
        project: string;
        task: string;
        reason: string;
    }>;
    lowBacklogProjects: BacklogHealth[];
    pendingProposals: Array<{
        project: string;
        title: string;
        id: string;
    }>;
}

/**
 * Generate morning briefing
 */
export function generateBriefing(): string {
    const data = gatherBriefingData();
    return formatBriefing(data);
}

/**
 * Gather data for the briefing
 */
function gatherBriefingData(): BriefingData {
    // Get work since midnight (or last 12 hours for evening runs)
    const midnightToday = new Date();
    midnightToday.setHours(0, 0, 0, 0);
    const since = midnightToday.toISOString();

    const recentWork = getWorkLogSince(since);

    // Completed overnight
    const completedOvernight = recentWork
        .filter(w => w.event_type === 'completed')
        .map(w => {
            const project = getProjectById(w.project_id);
            const details = w.details ? JSON.parse(w.details) : {};
            return {
                project: project?.name || 'Unknown',
                summary: w.summary,
                prUrl: details.pr_url,
            };
        });

    // Pending approvals (only task-based PRDs, not proposal-based)
    const pendingPrds = getPrdsByStatus('pending').filter(prd => prd.task_id !== null);
    const pendingApprovals = pendingPrds.map(prd => {
        const project = getProjectById(prd.project_id);
        const task = prd.task_id ? getTaskById(prd.task_id) : null;
        return {
            project: project?.name || 'Unknown',
            task: task?.title || (prd.proposal_id ? 'Proactive Proposal' : 'Unknown task'),
            riskLevel: getRiskLevel(prd.risk_score),
            riskScore: prd.risk_score,
        };
    }).sort((a, b) => b.riskScore - a.riskScore);

    // Blocked or failed
    const failedRuns = getRunsByStatus('failed');
    const blockedOrFailed = failedRuns.map(run => {
        const project = getProjectById(run.project_id);
        return {
            project: project?.name || 'Unknown',
            summary: `Run ${run.id.slice(0, 8)} failed`,
            error: run.error || undefined,
        };
    });

    // Add recent failures from work log
    const recentFailures = recentWork
        .filter(w => w.event_type === 'failed')
        .map(w => {
            const project = getProjectById(w.project_id);
            const details = w.details ? JSON.parse(w.details) : {};
            return {
                project: project?.name || 'Unknown',
                summary: w.summary,
                error: details.error,
            };
        });
    blockedOrFailed.push(...recentFailures);

    // Currently running
    const runningRuns = getRunsByStatus('running');
    const runningNow = runningRuns.map(run => {
        const project = getProjectById(run.project_id);
        return {
            project: project?.name || 'Unknown',
            branch: run.branch,
            iterations: `${run.iterations_completed}/${run.iterations_planned}`,
        };
    });

    // Suggested priorities (high priority backlog tasks)
    const projects = getAllProjects();
    const suggestedPriorities: BriefingData['suggestedPriorities'] = [];

    for (const project of projects) {
        const tasks = getTasksByProject(project.id);
        const highPriority = tasks
            .filter(t => t.status === 'backlog' && (t.priority === 'critical' || t.priority === 'high'))
            .slice(0, 2);

        for (const task of highPriority) {
            suggestedPriorities.push({
                project: project.name,
                task: task.title,
                reason: task.priority === 'critical' ? 'Critical priority' : 'High priority backlog item',
            });
        }
    }

    // Low backlog projects
    const lowBacklogProjects = getProjectsNeedingIdeas(3);

    // Pending proposals
    const proposedItems = getProposalsByStatus('proposed');
    const pendingProposals = proposedItems.map(p => {
        const project = getProjectById(p.project_id);
        return {
            project: project?.name || 'Unknown',
            title: p.title,
            id: p.id,
        };
    });

    return {
        completedOvernight,
        pendingApprovals,
        blockedOrFailed,
        runningNow,
        suggestedPriorities: suggestedPriorities.slice(0, 5),
        lowBacklogProjects,
        pendingProposals,
    };
}

function getRiskLevel(score: number): 'LOW' | 'MED' | 'HIGH' {
    if (score < 30) return 'LOW';
    if (score <= 70) return 'MED';
    return 'HIGH';
}

/**
 * Format briefing data as terminal output
 */
function formatBriefing(data: BriefingData): string {
    const lines: string[] = [];
    const today = new Date().toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
    });

    lines.push(chalk.bold.cyan('=== Fleet Morning Briefing ==='));
    lines.push(chalk.gray(today));
    lines.push('');

    // Completed overnight
    if (data.completedOvernight.length > 0) {
        lines.push(chalk.green('✓ Completed Overnight:'));
        for (const item of data.completedOvernight) {
            lines.push(chalk.green(`  + ${item.project}: ${item.summary}`));
            if (item.prUrl) {
                lines.push(chalk.gray(`    ${item.prUrl}`));
            }
        }
        lines.push('');
    }

    // Currently running
    if (data.runningNow.length > 0) {
        lines.push(chalk.blue('⟳ Currently Running:'));
        for (const item of data.runningNow) {
            lines.push(chalk.blue(`  ○ ${item.project}: ${item.branch} (${item.iterations})`));
        }
        lines.push('');
    }

    // Pending approvals
    if (data.pendingApprovals.length > 0) {
        lines.push(chalk.yellow(`⏳ Pending Approval (${data.pendingApprovals.length}):`));
        for (const item of data.pendingApprovals) {
            const riskColor = item.riskLevel === 'HIGH' ? chalk.red :
                item.riskLevel === 'MED' ? chalk.yellow : chalk.green;
            lines.push(`  ${riskColor(`[${item.riskLevel}]`)} ${item.project}: ${item.task}`);
        }
        lines.push('');
        lines.push(chalk.gray('  Run `fleet approve` to review'));
        lines.push('');
    }

    // Blocked/Failed
    if (data.blockedOrFailed.length > 0) {
        lines.push(chalk.red(`✗ Blocked/Failed (${data.blockedOrFailed.length}):`));
        for (const item of data.blockedOrFailed) {
            lines.push(chalk.red(`  x ${item.project}: ${item.summary}`));
            if (item.error) {
                lines.push(chalk.gray(`    ${item.error.slice(0, 100)}`));
            }
        }
        lines.push('');
    }

    // Suggested priorities
    if (data.suggestedPriorities.length > 0) {
        lines.push(chalk.magenta('→ Suggested Priorities:'));
        data.suggestedPriorities.forEach((item, i) => {
            lines.push(chalk.magenta(`  ${i + 1}. [${item.project}] ${item.task}`));
            lines.push(chalk.gray(`     ${item.reason}`));
        });
        lines.push('');
    }

    // Low backlog warnings
    if (data.lowBacklogProjects.length > 0) {
        lines.push(chalk.yellow('⚠ Low Backlog Warning:'));
        for (const item of data.lowBacklogProjects) {
            const countText = item.isEmpty ? 'Empty backlog' : `Only ${item.count} task(s) in backlog`;
            lines.push(chalk.yellow(`  ! ${item.projectName}: ${countText}`));
        }
        lines.push(chalk.gray('    Run `fleet ideate -p <project>` to generate ideas'));
        lines.push('');
    }

    // Pending proposals
    if (data.pendingProposals.length > 0) {
        lines.push(chalk.blue(`💡 Pending Proposals (${data.pendingProposals.length}):`));
        for (const item of data.pendingProposals) {
            lines.push(chalk.blue(`  [AI] ${item.project}: ${item.title}`));
        }
        lines.push(chalk.gray('    Run `fleet approve --proposals` to review'));
        lines.push('');
    }

    // Empty state
    if (
        data.completedOvernight.length === 0 &&
        data.pendingApprovals.length === 0 &&
        data.blockedOrFailed.length === 0 &&
        data.runningNow.length === 0
    ) {
        lines.push(chalk.gray('No recent activity. Run `fleet sync` to pull tasks.'));
        lines.push('');
    }

    return lines.join('\n');
}

/**
 * Get raw briefing data (for programmatic use)
 */
export function getBriefingData(): BriefingData {
    return gatherBriefingData();
}
