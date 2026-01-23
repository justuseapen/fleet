#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { statusCommand } from './commands/status.js';
import { approveCommand } from './commands/approve.js';
import { runCommand } from './commands/run.js';
import { projectsCommand } from './commands/projects.js';
import { syncCommand } from './commands/sync.js';
import { strategicCommand } from './commands/strategic.js';
import { analyzeCommand } from './commands/analyze.js';
import { cleanupCommand } from './commands/cleanup.js';
import { ideateCommand } from './commands/ideate.js';
import { monitorCommand } from './commands/monitor.js';
import { loadGlobalConfig, saveGlobalConfig } from './config.js';
import { closeDb } from '../db/index.js';

const program = new Command();

program
    .name('fleet')
    .description('Multi-agent orchestration system for autonomous development')
    .version('0.1.0');

// Add commands
program.addCommand(statusCommand);
program.addCommand(approveCommand);
program.addCommand(runCommand);
program.addCommand(projectsCommand);
program.addCommand(syncCommand);
program.addCommand(strategicCommand);
program.addCommand(analyzeCommand);
program.addCommand(cleanupCommand);
program.addCommand(ideateCommand);
program.addCommand(monitorCommand);

// Config command
program
    .command('config')
    .description('View or set global configuration')
    .argument('[key]', 'Configuration key')
    .argument('[value]', 'Configuration value')
    .action((key?: string, value?: string) => {
        const config = loadGlobalConfig();

        if (!key) {
            // Show all config
            console.log(chalk.bold('\nFleet Configuration:\n'));
            console.log(JSON.stringify(config, null, 2));
            return;
        }

        if (!value) {
            // Get specific key
            if (key in config) {
                console.log(config[key as keyof typeof config]);
            } else {
                console.error(chalk.red(`Unknown config key: ${key}`));
                console.log('Available keys:', Object.keys(config).join(', '));
                process.exit(1);
            }
            return;
        }

        // Set value
        const validKeys = ['maxGlobalConcurrency', 'defaultTool', 'anthropicApiKey', 'linearApiKey'];
        if (!validKeys.includes(key)) {
            console.error(chalk.red(`Unknown config key: ${key}`));
            console.log('Available keys:', validKeys.join(', '));
            process.exit(1);
        }

        // Type-specific parsing
        let parsedValue: string | number = value;
        if (key === 'maxGlobalConcurrency') {
            parsedValue = parseInt(value, 10);
            if (isNaN(parsedValue) || parsedValue < 1) {
                console.error(chalk.red('maxGlobalConcurrency must be a positive integer'));
                process.exit(1);
            }
        }

        // Safe assignment with proper typing
        if (key === 'maxGlobalConcurrency' && typeof parsedValue === 'number') {
            config.maxGlobalConcurrency = parsedValue;
        } else if (key === 'defaultTool' && (parsedValue === 'claude' || parsedValue === 'cursor')) {
            config.defaultTool = parsedValue;
        } else if (key === 'anthropicApiKey' && typeof parsedValue === 'string') {
            config.anthropicApiKey = parsedValue;
        } else if (key === 'linearApiKey' && typeof parsedValue === 'string') {
            config.linearApiKey = parsedValue;
        }
        saveGlobalConfig(config);
        console.log(chalk.green(`Set ${key} = ${parsedValue}`));
    });

// Plan command (generate PRDs for backlog tasks)
program
    .command('plan')
    .description('Generate PRDs for high-priority backlog tasks')
    .option('-n, --count <n>', 'Number of tasks to plan', '5')
    .option('-p, --project <name>', 'Plan only for a specific project')
    .action(async (options) => {
        const { Orchestrator } = await import('../orchestrator/index.js');
        const { getAllProjects, getTasksByStatus, getProjectById } = await import('../db/index.js');

        const config = loadGlobalConfig();
        const orchestrator = new Orchestrator(config);

        console.log(chalk.bold(`\nGenerating PRDs for high-priority tasks...\n`));

        const result = await orchestrator.planBacklogTasks(parseInt(options.count, 10));

        if (result.planned.length > 0) {
            console.log(chalk.green(`✓ Generated PRDs for ${result.planned.length} tasks:`));
            for (const taskId of result.planned) {
                console.log(chalk.gray(`    ${taskId}`));
            }
        } else {
            console.log(chalk.yellow('No high-priority tasks to plan'));
        }

        if (result.errors.length > 0) {
            console.log(chalk.red(`\n${result.errors.length} errors:`));
            for (const error of result.errors) {
                console.log(chalk.gray(`    ${error}`));
            }
        }

        if (result.planned.length > 0) {
            console.log('');
            console.log(chalk.gray('Run `fleet approve` to review generated PRDs'));
        }
    });

// Handle errors
program.exitOverride();

try {
    await program.parseAsync(process.argv);
} catch (error) {
    if (error instanceof Error && error.message !== '(outputHelp)') {
        console.error(chalk.red(`Error: ${error.message}`));
        process.exit(1);
    }
} finally {
    closeDb();
}
