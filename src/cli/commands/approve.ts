import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import {
    getPendingApprovals,
    approvePrd,
    rejectPrd,
    processAutoApprovals,
} from '../../approval/queue.js';
import { getPrdById } from '../../db/index.js';

export const approveCommand = new Command('approve')
    .description('Interactive approval of pending PRDs')
    .option('--auto', 'Auto-approve low-risk PRDs only')
    .option('--id <prdId>', 'Approve a specific PRD by ID')
    .option('--reject <prdId>', 'Reject a specific PRD by ID')
    .action(async (options) => {
        // Auto-approve mode
        if (options.auto) {
            const { approved, skipped } = processAutoApprovals();
            console.log(chalk.green(`Auto-approved ${approved.length} low-risk PRDs`));
            console.log(chalk.yellow(`${skipped.length} PRDs require manual review`));
            return;
        }

        // Direct approve by ID
        if (options.id) {
            try {
                approvePrd(options.id, process.env.USER || 'user');
                console.log(chalk.green(`Approved PRD ${options.id}`));
            } catch (error) {
                console.error(chalk.red(`Failed to approve: ${error}`));
            }
            return;
        }

        // Direct reject by ID
        if (options.reject) {
            try {
                rejectPrd(options.reject);
                console.log(chalk.yellow(`Rejected PRD ${options.reject}`));
            } catch (error) {
                console.error(chalk.red(`Failed to reject: ${error}`));
            }
            return;
        }

        // Interactive mode
        const pending = getPendingApprovals();

        if (pending.length === 0) {
            console.log(chalk.gray('No pending PRDs to approve'));
            return;
        }

        console.log(chalk.bold(`\n${pending.length} PRDs pending approval\n`));

        for (const item of pending) {
            const riskColor = item.prd.risk_score > 70 ? chalk.red :
                item.prd.risk_score > 30 ? chalk.yellow : chalk.green;

            console.log(chalk.bold.cyan(`\n--- ${item.project.name} ---`));
            console.log(`Task: ${item.task.title}`);
            console.log(`Type: ${item.task.task_type}`);
            console.log(`Risk Score: ${riskColor(String(item.prd.risk_score))}`);
            console.log('');

            // Show risk breakdown
            console.log(chalk.gray('Risk Breakdown:'));
            for (const [factor, data] of Object.entries(item.riskBreakdown)) {
                console.log(chalk.gray(`  ${factor}: ${data.score} - ${data.description}`));
            }
            console.log('');

            // Show PRD summary (first few lines)
            const prdLines = item.prd.content.split('\n').slice(0, 10);
            console.log(chalk.gray('PRD Preview:'));
            console.log(chalk.gray(prdLines.join('\n')));
            if (item.prd.content.split('\n').length > 10) {
                console.log(chalk.gray('...'));
            }
            console.log('');

            // Parse user stories count
            const prdJson = JSON.parse(item.prd.prd_json);
            console.log(chalk.gray(`User Stories: ${prdJson.userStories?.length || 0}`));
            console.log('');

            // Prompt for action
            const { action } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'action',
                    message: 'Action:',
                    choices: [
                        { name: chalk.green('Approve'), value: 'approve' },
                        { name: chalk.red('Reject'), value: 'reject' },
                        { name: chalk.blue('View full PRD'), value: 'view' },
                        { name: chalk.yellow('Skip'), value: 'skip' },
                        { name: chalk.gray('Exit'), value: 'exit' },
                    ],
                },
            ]);

            if (action === 'approve') {
                approvePrd(item.prd.id, process.env.USER || 'user');
                console.log(chalk.green('✓ Approved'));
            } else if (action === 'reject') {
                const { reason } = await inquirer.prompt([
                    {
                        type: 'input',
                        name: 'reason',
                        message: 'Rejection reason (optional):',
                    },
                ]);
                rejectPrd(item.prd.id, reason);
                console.log(chalk.red('✗ Rejected'));
            } else if (action === 'view') {
                console.log('\n' + chalk.cyan('=== Full PRD ===') + '\n');
                console.log(item.prd.content);
                console.log('\n' + chalk.cyan('=== prd.json ===') + '\n');
                console.log(JSON.stringify(prdJson, null, 2));

                // Re-prompt after viewing
                const { viewAction } = await inquirer.prompt([
                    {
                        type: 'list',
                        name: 'viewAction',
                        message: 'Action:',
                        choices: [
                            { name: chalk.green('Approve'), value: 'approve' },
                            { name: chalk.red('Reject'), value: 'reject' },
                            { name: chalk.yellow('Skip'), value: 'skip' },
                        ],
                    },
                ]);

                if (viewAction === 'approve') {
                    approvePrd(item.prd.id, process.env.USER || 'user');
                    console.log(chalk.green('✓ Approved'));
                } else if (viewAction === 'reject') {
                    rejectPrd(item.prd.id);
                    console.log(chalk.red('✗ Rejected'));
                }
            } else if (action === 'exit') {
                console.log(chalk.gray('Exiting approval workflow'));
                break;
            }
            // skip continues to next
        }

        console.log(chalk.bold('\nApproval session complete'));
    });
