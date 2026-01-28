import { Command } from 'commander';
import chalk from 'chalk';
import {
    getStaleRuns,
    markStaleRunsAsFailed,
    getOldFailedRuns,
    clearOldFailedRuns,
    getAllProjects,
    getRunsByStatus,
} from '../../db/index.js';
import { cleanupOrphanedWorktrees } from '../../git/worktree.js';

export const cleanupCommand = new Command('cleanup')
    .description('Clean up stale runs, old failed records, and orphaned worktrees')
    .option('--stale', 'Mark stale running runs as failed (>1 hour with no progress)')
    .option('--failed', 'Clear old failed run records')
    .option('--worktrees', 'Remove orphaned git worktrees from crashed/interrupted runs')
    .option('--days <days>', 'Days of history to keep when clearing failed runs', '7')
    .option('--minutes <minutes>', 'Minutes threshold for stale detection', '60')
    .option('--dry-run', 'Show what would be cleaned without making changes')
    .action(async (options) => {
        const minutes = parseInt(options.minutes, 10);
        const days = parseInt(options.days, 10);

        if (!options.stale && !options.failed && !options.worktrees) {
            console.log(chalk.yellow('Specify --stale, --failed, and/or --worktrees to clean up'));
            console.log(chalk.gray('  --stale      Mark stuck running runs as failed'));
            console.log(chalk.gray('  --failed     Clear old failed run history'));
            console.log(chalk.gray('  --worktrees  Remove orphaned git worktrees'));
            return;
        }

        if (options.stale) {
            const staleRuns = getStaleRuns(minutes);
            if (staleRuns.length === 0) {
                console.log(chalk.green('No stale runs found'));
            } else if (options.dryRun) {
                console.log(chalk.yellow(`Would mark ${staleRuns.length} stale run(s) as failed:`));
                for (const run of staleRuns) {
                    console.log(chalk.gray(`  - ${run.id.slice(0, 8)} (${run.branch})`));
                }
            } else {
                const count = markStaleRunsAsFailed(minutes);
                console.log(chalk.green(`Marked ${count} stale run(s) as failed`));
            }
        }

        if (options.failed) {
            const oldRuns = getOldFailedRuns(days);
            if (oldRuns.length === 0) {
                console.log(chalk.green(`No failed runs older than ${days} day(s)`));
            } else if (options.dryRun) {
                console.log(chalk.yellow(`Would delete ${oldRuns.length} old failed run(s):`));
                for (const run of oldRuns.slice(0, 10)) {
                    console.log(chalk.gray(`  - ${run.id.slice(0, 8)} (${run.error?.slice(0, 40)}...)`));
                }
                if (oldRuns.length > 10) {
                    console.log(chalk.gray(`  ... and ${oldRuns.length - 10} more`));
                }
            } else {
                const count = clearOldFailedRuns(days);
                console.log(chalk.green(`Deleted ${count} old failed run(s)`));
            }
        }

        if (options.worktrees) {
            const projects = getAllProjects();
            const activeRunIds = new Set(
                getRunsByStatus('running').map(r => r.id)
            );

            let totalRemoved = 0;
            for (const project of projects) {
                const removed = await cleanupOrphanedWorktrees(
                    project.path,
                    project.id,
                    activeRunIds
                );
                if (removed.length > 0) {
                    console.log(chalk.green(`Removed ${removed.length} orphaned worktree(s) for ${project.name}`));
                    for (const runId of removed) {
                        console.log(chalk.gray(`  - ${runId.slice(0, 8)}`));
                    }
                    totalRemoved += removed.length;
                }
            }

            if (totalRemoved === 0) {
                console.log(chalk.green('No orphaned worktrees found'));
            }
        }
    });
