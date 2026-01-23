import { Command } from 'commander';
import chalk from 'chalk';
import { Orchestrator } from '../../orchestrator/index.js';
import { getAllProjects, getProjectById } from '../../db/index.js';
import { loadGlobalConfig } from '../config.js';

export const syncCommand = new Command('sync')
    .description('Pull latest tasks from all sources')
    .option('-p, --project <name>', 'Sync only a specific project')
    .option('--plan', 'Also generate PRDs for high-priority tasks')
    .option('--plan-count <n>', 'Number of tasks to plan (default: 5)', parseInt)
    .action(async (options) => {
        const globalConfig = loadGlobalConfig();
        const orchestrator = new Orchestrator(globalConfig);

        const projects = getAllProjects();

        if (projects.length === 0) {
            console.log(chalk.yellow('No projects configured'));
            console.log(chalk.gray('Run `fleet projects add <path>` to add a project'));
            return;
        }

        // Filter by project if specified
        let projectFilter: string | undefined;
        if (options.project) {
            const match = projects.find(p =>
                p.name.toLowerCase() === options.project.toLowerCase() ||
                p.id === options.project
            );
            if (!match) {
                console.error(chalk.red(`Project not found: ${options.project}`));
                console.log('Available projects:');
                for (const p of projects) {
                    console.log(`  - ${p.name}`);
                }
                process.exit(1);
            }
            projectFilter = match.id;
        }

        console.log(chalk.bold('\nSyncing tasks...\n'));

        // Sync
        const results = await orchestrator.syncAllProjects();

        let totalSynced = 0;
        let totalErrors = 0;

        for (const [projectId, result] of results) {
            if (projectFilter && projectId !== projectFilter) continue;

            const project = getProjectById(projectId);
            const name = project?.name || 'Unknown';

            if (result.errors.length > 0) {
                console.log(chalk.red(`✗ ${name}: ${result.errors.length} errors`));
                for (const error of result.errors) {
                    console.log(chalk.gray(`    ${error}`));
                }
                totalErrors += result.errors.length;
            } else if (result.synced > 0) {
                console.log(chalk.green(`✓ ${name}: ${result.synced} tasks synced`));
                totalSynced += result.synced;
            } else {
                console.log(chalk.gray(`○ ${name}: No new tasks`));
            }
        }

        console.log('');
        console.log(chalk.bold(`Total: ${totalSynced} tasks synced`));

        if (totalErrors > 0) {
            console.log(chalk.red(`Errors: ${totalErrors}`));
        }

        // Optionally plan high-priority tasks
        if (options.plan) {
            const planCount = options.planCount || 5;
            console.log(chalk.bold(`\nPlanning top ${planCount} high-priority tasks...\n`));

            const planResult = await orchestrator.planBacklogTasks(planCount);

            if (planResult.planned.length > 0) {
                console.log(chalk.green(`✓ Generated PRDs for ${planResult.planned.length} tasks:`));
                for (const taskId of planResult.planned) {
                    console.log(chalk.gray(`    ${taskId}`));
                }
            }

            if (planResult.errors.length > 0) {
                console.log(chalk.red(`\n${planResult.errors.length} planning errors:`));
                for (const error of planResult.errors) {
                    console.log(chalk.gray(`    ${error}`));
                }
            }

            if (planResult.planned.length > 0) {
                console.log('');
                console.log(chalk.gray('Run `fleet approve` to review generated PRDs'));
            }
        }
    });
