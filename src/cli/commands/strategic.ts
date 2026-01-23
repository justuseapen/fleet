import { Command } from 'commander';
import chalk from 'chalk';
import { StrategicAgent } from '../../agents/strategic.js';
import { getAllProjects, getProjectById } from '../../db/index.js';

export const strategicCommand = new Command('strategic')
    .description('Run strategic audit (mission alignment, scope creep detection)')
    .option('-p, --project <name>', 'Audit only a specific project')
    .option('--all', 'Run cross-project audit')
    .action(async (options) => {
        const agent = new StrategicAgent();

        if (options.all || !options.project) {
            // Cross-project audit
            console.log(chalk.bold('\nRunning cross-project strategic audit...\n'));

            try {
                const result = await agent.runCrossProjectAudit();

                console.log(result.report);

                // Summary
                console.log(chalk.bold('\n=== Summary ===\n'));

                for (const summary of result.projectSummaries) {
                    const scoreColor = summary.score >= 7 ? chalk.green :
                        summary.score >= 5 ? chalk.yellow : chalk.red;
                    const riskColor = summary.risk === 'Low' ? chalk.green :
                        summary.risk === 'Medium' ? chalk.yellow : chalk.red;

                    console.log(`${chalk.cyan(summary.project)}`);
                    console.log(`  Mission Alignment: ${scoreColor(String(summary.score) + '/10')}`);
                    console.log(`  Scope Creep Risk: ${riskColor(summary.risk)}`);
                    console.log('');
                }
            } catch (error) {
                console.error(chalk.red(`Audit failed: ${error}`));
                process.exit(1);
            }
        } else {
            // Single project audit
            const projects = getAllProjects();
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

            console.log(chalk.bold(`\nRunning strategic audit for ${project.name}...\n`));

            try {
                const result = await agent.execute({
                    project,
                    workDir: project.path,
                });

                if (result.success) {
                    const artifacts = result.artifacts as {
                        missionScore: number;
                        scopeCreepRisk: string;
                        recommendations: string[];
                        redFlags: string[];
                    };

                    const scoreColor = artifacts.missionScore >= 7 ? chalk.green :
                        artifacts.missionScore >= 5 ? chalk.yellow : chalk.red;
                    const riskColor = artifacts.scopeCreepRisk === 'Low' ? chalk.green :
                        artifacts.scopeCreepRisk === 'Medium' ? chalk.yellow : chalk.red;

                    console.log(chalk.bold('Results:'));
                    console.log(`  Mission Alignment: ${scoreColor(String(artifacts.missionScore) + '/10')}`);
                    console.log(`  Scope Creep Risk: ${riskColor(artifacts.scopeCreepRisk)}`);
                    console.log('');

                    if (artifacts.redFlags.length > 0) {
                        console.log(chalk.red('🚨 Red Flags:'));
                        for (const flag of artifacts.redFlags) {
                            console.log(chalk.red(`  - ${flag}`));
                        }
                        console.log('');
                    }

                    if (artifacts.recommendations.length > 0) {
                        console.log(chalk.bold('Recommendations:'));
                        artifacts.recommendations.forEach((rec, i) => {
                            console.log(`  ${i + 1}. ${rec}`);
                        });
                        console.log('');
                    }
                } else {
                    console.error(chalk.red(`Audit failed: ${result.error}`));
                    process.exit(1);
                }
            } catch (error) {
                console.error(chalk.red(`Audit failed: ${error}`));
                process.exit(1);
            }
        }
    });
