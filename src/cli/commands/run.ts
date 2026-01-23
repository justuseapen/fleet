import { Command } from 'commander';
import chalk from 'chalk';
import { Orchestrator, Scheduler } from '../../orchestrator/index.js';
import { getProjectByPath, getAllProjects, getProjectById } from '../../db/index.js';
import { defaultGlobalConfig } from '../../types.js';
import { loadGlobalConfig } from '../config.js';

export const runCommand = new Command('run')
    .description('Execute approved tasks via Ralph (parallel)')
    .option('-p, --project <name>', 'Run only for a specific project')
    .option('--dry-run', 'Show what would be executed without running')
    .option('--max-concurrent <n>', 'Override max concurrent agents', parseInt)
    .action(async (options) => {
        const globalConfig = loadGlobalConfig();

        if (options.maxConcurrent) {
            globalConfig.maxGlobalConcurrency = options.maxConcurrent;
        }

        const orchestrator = new Orchestrator(globalConfig);
        const scheduler = orchestrator.getScheduler();

        // Check what's already running
        const running = scheduler.getRunningStatus();
        if (running.length > 0) {
            console.log(chalk.blue('Currently running:'));
            for (const r of running) {
                console.log(chalk.blue(`  ○ ${r.projectName}`));
            }
            console.log('');
        }

        // Filter by project if specified
        let projectFilter: string | undefined;
        if (options.project) {
            const projects = getAllProjects();
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

        // Schedule approved PRDs
        const scheduled = await scheduler.scheduleApproved();

        // Filter if project specified
        const toRun = projectFilter
            ? scheduled.filter(s => s.project.id === projectFilter)
            : scheduled;

        if (toRun.length === 0) {
            console.log(chalk.yellow('No approved PRDs ready to execute'));
            console.log(chalk.gray('Run `fleet approve` to approve pending PRDs'));
            return;
        }

        console.log(chalk.bold(`\nScheduled ${toRun.length} execution(s):\n`));

        for (const { project, prd, run } of toRun) {
            const prdJson = JSON.parse(prd.prd_json);
            console.log(`  ${chalk.cyan(project.name)}`);
            console.log(`    Branch: ${run.branch}`);
            console.log(`    Stories: ${prdJson.userStories?.length || 0}`);
            console.log(`    Iterations: ${run.iterations_planned}`);
            console.log('');
        }

        if (options.dryRun) {
            console.log(chalk.yellow('Dry run - no execution'));
            return;
        }

        // Confirm execution
        const readline = await import('readline');
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });

        const confirm = await new Promise<string>((resolve) => {
            rl.question(chalk.bold('Start execution? [y/N] '), resolve);
        });
        rl.close();

        if (confirm.toLowerCase() !== 'y') {
            console.log(chalk.gray('Cancelled'));
            return;
        }

        console.log(chalk.bold('\nStarting execution...\n'));

        // Execute
        const results = await scheduler.executeRuns(toRun);

        // Report results
        console.log(chalk.bold('\n=== Execution Results ===\n'));

        let successCount = 0;
        let failCount = 0;

        for (const [runId, result] of results) {
            const run = toRun.find(r => r.run.id === runId);
            const projectName = run?.project.name || 'Unknown';

            if (result.success) {
                console.log(chalk.green(`✓ ${projectName}: Completed`));
                successCount++;
            } else {
                console.log(chalk.red(`✗ ${projectName}: Failed`));
                if (result.error) {
                    console.log(chalk.gray(`  ${result.error}`));
                }
                failCount++;
            }
        }

        console.log('');
        console.log(chalk.bold(`Success: ${successCount}, Failed: ${failCount}`));
    });
