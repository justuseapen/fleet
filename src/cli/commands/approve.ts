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
import {
    getPrdById,
    getProposalsByStatus,
    getProjectById,
    getPrdByProposalId,
    updateProposalStatus,
    updatePrdStatus,
    insertWorkLog,
    generateId,
    type Proposal,
} from '../../db/index.js';

export const approveCommand = new Command('approve')
    .description('Interactive approval of pending PRDs')
    .option('--auto', 'Auto-approve low-risk PRDs only')
    .option('--id <prdId>', 'Approve a specific PRD by ID')
    .option('--reject <prdId>', 'Reject a specific PRD by ID')
    .option('-q, --quality', 'Sort by quality score and show quality metrics')
    .option('--sort <field>', 'Sort by: risk, quality, confidence', 'risk')
    .option('--proposals', 'Review proactive feature proposals from VisionaryAgent')
    .action(async (options) => {
        // Proposals mode
        if (options.proposals) {
            await handleProposalsApproval();
            return;
        }

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

/**
 * Handle approval workflow for proactive proposals
 */
async function handleProposalsApproval(): Promise<void> {
    const proposals = getProposalsByStatus('proposed');

    if (proposals.length === 0) {
        console.log(chalk.gray('No pending proposals to review'));
        console.log(chalk.gray('Run `fleet ideate -p <project>` to generate proposals'));
        return;
    }

    console.log(chalk.bold(`\n${proposals.length} proposal(s) pending review\n`));

    for (const proposal of proposals) {
        const project = getProjectById(proposal.project_id);
        const prd = getPrdByProposalId(proposal.id);

        console.log(chalk.bold.cyan(`\n--- [AI] ${project?.name || 'Unknown'} ---`));
        console.log(chalk.bold(`Proposal: ${proposal.title}`));
        console.log('');
        console.log(chalk.bold('Rationale:'));
        console.log(chalk.gray(proposal.rationale || 'No rationale provided'));
        console.log('');

        // Show PRD summary if available
        if (prd) {
            const riskColor = prd.risk_score > 70 ? chalk.red :
                prd.risk_score > 30 ? chalk.yellow : chalk.green;
            console.log(`Risk Score: ${riskColor(String(prd.risk_score))}`);

            // Parse and show user stories
            try {
                const prdJson = JSON.parse(prd.prd_json);
                console.log(`User Stories: ${prdJson.userStories?.length || 0}`);
                if (prdJson.userStories && prdJson.userStories.length > 0) {
                    console.log(chalk.gray('Stories:'));
                    for (const story of prdJson.userStories.slice(0, 3)) {
                        console.log(chalk.gray(`  - ${story.title}`));
                    }
                    if (prdJson.userStories.length > 3) {
                        console.log(chalk.gray(`  ... and ${prdJson.userStories.length - 3} more`));
                    }
                }
            } catch {
                // Skip if JSON parse fails
            }
            console.log('');
        }

        // Show source context if available
        if (proposal.source_context) {
            try {
                const context = JSON.parse(proposal.source_context);
                console.log(chalk.gray(`Generated: ${context.generated_at || 'Unknown'}`));
            } catch {
                // Skip if parse fails
            }
        }
        console.log('');

        // Prompt for action
        const { action } = await inquirer.prompt([
            {
                type: 'list',
                name: 'action',
                message: 'Action:',
                choices: [
                    { name: chalk.green('Approve - Ready to execute'), value: 'approve' },
                    { name: chalk.red('Reject - Not needed'), value: 'reject' },
                    { name: chalk.blue('View full PRD'), value: 'view' },
                    { name: chalk.yellow('Skip'), value: 'skip' },
                    { name: chalk.gray('Exit'), value: 'exit' },
                ],
            },
        ]);

        if (action === 'approve') {
            await approveProposal(proposal, prd);
            console.log(chalk.green('✓ Approved'));
        } else if (action === 'reject') {
            const { reason } = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'reason',
                    message: 'Rejection reason (optional):',
                },
            ]);
            await rejectProposal(proposal, prd, reason);
            console.log(chalk.red('✗ Rejected'));
        } else if (action === 'view') {
            if (prd) {
                console.log('\n' + chalk.cyan('=== Full PRD ===') + '\n');
                console.log(prd.content);
                console.log('\n' + chalk.cyan('=== prd.json ===') + '\n');
                try {
                    console.log(JSON.stringify(JSON.parse(prd.prd_json), null, 2));
                } catch {
                    console.log(prd.prd_json);
                }
            } else {
                console.log(chalk.gray('No PRD content available'));
            }

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
                await approveProposal(proposal, prd);
                console.log(chalk.green('✓ Approved'));
            } else if (viewAction === 'reject') {
                await rejectProposal(proposal, prd);
                console.log(chalk.red('✗ Rejected'));
            }
        } else if (action === 'exit') {
            console.log(chalk.gray('Exiting proposal review'));
            break;
        }
        // skip continues to next
    }

    console.log(chalk.bold('\nProposal review session complete'));
}

async function approveProposal(
    proposal: Proposal,
    prd: { id: string; project_id: string } | undefined
): Promise<void> {
    // Update proposal status
    updateProposalStatus(proposal.id, 'approved');

    // If there's a linked PRD, approve it too
    if (prd) {
        updatePrdStatus(prd.id, 'approved', process.env.USER || 'user');
    }

    // Log the approval
    insertWorkLog({
        id: generateId(),
        run_id: null,
        project_id: proposal.project_id,
        event_type: 'approved',
        summary: `Proposal approved: ${proposal.title}`,
        details: JSON.stringify({
            proposal_id: proposal.id,
            prd_id: prd?.id,
            approved_by: process.env.USER || 'user',
        }),
    });
}

async function rejectProposal(
    proposal: Proposal,
    prd: { id: string; project_id: string } | undefined,
    reason?: string
): Promise<void> {
    // Update proposal status
    updateProposalStatus(proposal.id, 'rejected');

    // If there's a linked PRD, reject it too
    if (prd) {
        updatePrdStatus(prd.id, 'rejected');
    }

    // Log the rejection
    insertWorkLog({
        id: generateId(),
        run_id: null,
        project_id: proposal.project_id,
        event_type: 'rejected',
        summary: `Proposal rejected: ${proposal.title}`,
        details: JSON.stringify({
            proposal_id: proposal.id,
            prd_id: prd?.id,
            reason,
        }),
    });
}
