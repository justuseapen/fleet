import { Command } from 'commander';
import chalk from 'chalk';
import { VisionaryAgent } from '../../agents/visionary.js';
import { getAllProjects, getProposalsByProject, type Project } from '../../db/index.js';
import { getBacklogHealth } from '../../orchestrator/backlog-analyzer.js';

export const ideateCommand = new Command('ideate')
    .description('Generate proactive feature proposals based on project mission')
    .option('-p, --project <name>', 'Generate ideas for a specific project')
    .option('-n, --count <n>', 'Number of ideas to generate', '3')
    .option('--dry-run', 'Preview proposals without saving to database')
    .action(async (options) => {
        const agent = new VisionaryAgent();
        const count = parseInt(options.count, 10);

        if (isNaN(count) || count < 1 || count > 5) {
            console.error(chalk.red('Count must be between 1 and 5'));
            process.exit(1);
        }

        const projects = getAllProjects();

        if (projects.length === 0) {
            console.error(chalk.red('No projects registered. Run `fleet projects add` first.'));
            process.exit(1);
        }

        // Determine which projects to process
        let targetProjects: Project[];

        if (options.project) {
            const project = projects.find(p =>
                p.name.toLowerCase() === options.project.toLowerCase() ||
                p.id === options.project
            );

            if (!project) {
                console.error(chalk.red(`Project not found: ${options.project}`));
                console.log('Available projects:');
                for (const p of projects) {
                    console.log(`  - ${p.name}`);
                }
                process.exit(1);
            }

            targetProjects = [project];
        } else {
            // If no project specified, show all projects
            console.log(chalk.bold('\nNo project specified. Available projects:\n'));
            for (const p of projects) {
                const health = getBacklogHealth(p.id);
                const statusColor = health.isEmpty ? chalk.red :
                    health.isLow ? chalk.yellow : chalk.green;
                console.log(`  ${chalk.cyan(p.name)} - ${statusColor(`${health.count} tasks in backlog`)}`);
            }
            console.log('');
            console.log(chalk.gray('Run with -p <project> to generate ideas for a specific project'));
            return;
        }

        for (const project of targetProjects) {
            console.log(chalk.bold(`\nGenerating ${count} feature proposal(s) for ${project.name}...\n`));

            // Show backlog status
            const health = getBacklogHealth(project.id);
            if (health.isEmpty) {
                console.log(chalk.yellow('! Backlog is empty - good time to generate ideas\n'));
            } else if (health.isLow) {
                console.log(chalk.yellow(`! Backlog is low (${health.count} tasks) - generating ideas\n`));
            }

            try {
                if (options.dryRun) {
                    // Dry run - just show proposals without saving
                    console.log(chalk.gray('(Dry run - proposals will not be saved)\n'));

                    const proposals = await agent.generateProposals(project, project.path, count);

                    for (const proposal of proposals) {
                        console.log(chalk.bold.cyan(`\n=== ${proposal.title} ===\n`));
                        console.log(chalk.bold('Rationale:'));
                        console.log(chalk.gray(proposal.rationale || 'No rationale provided'));
                        console.log('');
                        console.log(chalk.bold('User Stories:'));
                        for (const story of proposal.prdJson.userStories) {
                            console.log(`  - ${story.title}`);
                        }
                        console.log('');
                        console.log(chalk.gray('---'));
                    }

                    console.log(chalk.bold.green(`\n${proposals.length} proposal(s) generated (dry run - not saved)`));
                } else {
                    // Actually save proposals
                    const result = await agent.execute({
                        project,
                        workDir: project.path,
                    });

                    if (result.success) {
                        const artifacts = result.artifacts as {
                            proposalCount: number;
                            proposalIds: string[];
                            titles: string[];
                        };

                        console.log(chalk.green(`\n${artifacts.proposalCount} proposal(s) generated and saved:\n`));

                        for (let i = 0; i < artifacts.titles.length; i++) {
                            console.log(chalk.cyan(`  [AI] ${project.name}: ${artifacts.titles[i]}`));
                        }

                        console.log('');
                        console.log(chalk.gray('Run `fleet approve --proposals` to review'));
                        console.log(chalk.gray('Or view in status: `fleet status`'));
                    } else {
                        console.error(chalk.red(`Failed to generate proposals: ${result.error}`));
                        process.exit(1);
                    }
                }
            } catch (error) {
                console.error(chalk.red(`Error generating proposals: ${error}`));
                process.exit(1);
            }
        }
    });
