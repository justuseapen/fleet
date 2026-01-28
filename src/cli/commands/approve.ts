import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import {
    getPendingApprovals,
    getPendingApprovalsByQuality,
    approvePrd,
    rejectPrd,
    processAutoApprovals,
} from '../../approval/queue.js';
import { formatQualityScore } from '../../approval/quality.js';
import { getPrdById } from '../../db/index.js';

export const approveCommand = new Command('approve')
    .description('Interactive approval of pending PRDs')
    .option('--auto', 'Auto-approve low-risk PRDs only')
    .option('--id <prdId>', 'Approve a specific PRD by ID')
    .option('--reject <prdId>', 'Reject a specific PRD by ID')
    .option('-q, --quality', 'Sort by quality score and show quality metrics')
    .option('--sort <field>', 'Sort by: risk, quality, confidence', 'risk')
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

        // Interactive mode - get pending approvals with quality scores if requested
        const showQuality = options.quality || options.sort === 'quality' || options.sort === 'confidence';
        let pending = showQuality ? getPendingApprovalsByQuality() : getPendingApprovals(showQuality);

        // Apply sorting
        if (options.sort === 'confidence') {
            pending = pending.sort((a, b) => {
                const confA = a.quality?.confidence ?? 0;
                const confB = b.quality?.confidence ?? 0;
                return confB - confA;
            });
        } else if (options.sort === 'risk') {
            pending = pending.sort((a, b) => b.prd.risk_score - a.prd.risk_score);
        }

        if (pending.length === 0) {
            console.log(chalk.gray('No pending PRDs to approve'));
            return;
        }

        console.log(chalk.bold(`\n${pending.length} PRDs pending approval\n`));

        if (showQuality) {
            console.log(chalk.gray(`Sorted by: ${options.sort}`));
            console.log('');
        }

        for (const item of pending) {
            const riskColor = item.prd.risk_score > 70 ? chalk.red :
                item.prd.risk_score > 30 ? chalk.yellow : chalk.green;

            console.log(chalk.bold.cyan(`\n--- ${item.project.name} ---`));
            console.log(`Task: ${item.task?.title || 'Proactive Proposal'}`);
            console.log(`Type: ${item.task?.task_type || 'feature'}`);
            console.log(`Risk Score: ${riskColor(String(item.prd.risk_score))}`);

            // Show quality score if available
            if (item.quality) {
                const qualityColor = item.quality.overall >= 80 ? chalk.green :
                    item.quality.overall >= 60 ? chalk.yellow : chalk.red;
                const confidenceColor = item.quality.confidence >= 70 ? chalk.green :
                    item.quality.confidence >= 50 ? chalk.yellow : chalk.red;

                console.log(`Quality: ${qualityColor(`${item.quality.grade} (${item.quality.overall}/100)`)}`);
                console.log(`Confidence: ${confidenceColor(`${item.quality.confidence}%`)}`);
            }
            console.log('');

            // Show risk breakdown
            console.log(chalk.dim('Risk Breakdown:'));
            for (const [factor, data] of Object.entries(item.riskBreakdown)) {
                console.log(`  ${factor}: ${data.score} - ${data.description}`);
            }
            console.log('');

            // Show quality issues and suggestions if available
            if (item.quality && (item.quality.issues.length > 0 || item.quality.suggestions.length > 0)) {
                if (item.quality.issues.length > 0) {
                    console.log(chalk.yellow('Quality Issues:'));
                    for (const issue of item.quality.issues.slice(0, 3)) {
                        console.log(chalk.yellow(`  ⚠️  ${issue}`));
                    }
                    if (item.quality.issues.length > 3) {
                        console.log(chalk.gray(`  ... and ${item.quality.issues.length - 3} more`));
                    }
                }
                if (item.quality.suggestions.length > 0) {
                    console.log(chalk.blue('Suggestions:'));
                    for (const suggestion of item.quality.suggestions.slice(0, 2)) {
                        console.log(chalk.blue(`  💡 ${suggestion}`));
                    }
                }
                console.log('');
            }

            // Show PRD summary (first few lines)
            const prdLines = item.prd.content.split('\n').slice(0, 10);
            console.log(chalk.dim('PRD Preview:'));
            console.log(prdLines.join('\n'));
            if (item.prd.content.split('\n').length > 10) {
                console.log('...');
            }
            console.log('');

            // Parse user stories count
            const prdJson = JSON.parse(item.prd.prd_json);
            console.log(`User Stories: ${prdJson.userStories?.length || 0}`);
            console.log('');

            // Prompt for action
            const choices = [
                { name: chalk.green('Approve'), value: 'approve' },
                { name: chalk.red('Reject'), value: 'reject' },
                { name: chalk.blue('View full PRD'), value: 'view' },
            ];

            if (item.quality) {
                choices.push({ name: chalk.magenta('View quality details'), value: 'quality' });
            }

            choices.push(
                { name: chalk.yellow('Skip'), value: 'skip' },
                { name: chalk.gray('Exit'), value: 'exit' }
            );

            const { action } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'action',
                    message: 'Action:',
                    choices,
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
            } else if (action === 'quality' && item.quality) {
                console.log('\n' + chalk.magenta('=== Quality Analysis ===') + '\n');
                console.log(formatQualityScore(item.quality));
                console.log('');

                // Re-prompt after viewing quality
                const { qualityAction } = await inquirer.prompt([
                    {
                        type: 'list',
                        name: 'qualityAction',
                        message: 'Action:',
                        choices: [
                            { name: chalk.green('Approve'), value: 'approve' },
                            { name: chalk.red('Reject'), value: 'reject' },
                            { name: chalk.yellow('Skip'), value: 'skip' },
                        ],
                    },
                ]);

                if (qualityAction === 'approve') {
                    approvePrd(item.prd.id, process.env.USER || 'user');
                    console.log(chalk.green('✓ Approved'));
                } else if (qualityAction === 'reject') {
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
