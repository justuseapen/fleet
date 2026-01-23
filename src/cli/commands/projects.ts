import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve, basename } from 'path';
import {
    getAllProjects,
    getProjectByPath,
    insertProject,
    deleteProject,
    generateId,
} from '../../db/index.js';
import {
    defaultAgentConfig,
    defaultApprovalConfig,
    defaultExecutionConfig,
    type FleetProjectConfig,
    type TaskSourceConfig,
} from '../../types.js';

export const projectsCommand = new Command('projects')
    .description('Project management');

// List projects
projectsCommand
    .command('list')
    .alias('ls')
    .description('List configured projects')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
        const projects = getAllProjects();

        if (options.json) {
            console.log(JSON.stringify(projects, null, 2));
            return;
        }

        if (projects.length === 0) {
            console.log(chalk.gray('No projects configured'));
            console.log(chalk.gray('Run `fleet projects add <path>` to add a project'));
            return;
        }

        console.log(chalk.bold('\nConfigured Projects:\n'));

        for (const project of projects) {
            const sourceConfig: TaskSourceConfig = JSON.parse(project.task_source_config);
            let sourceInfo = '';

            switch (sourceConfig.type) {
                case 'jira':
                    sourceInfo = `Jira: ${sourceConfig.project}`;
                    break;
                case 'github':
                    sourceInfo = `GitHub: ${sourceConfig.owner}/${sourceConfig.repo}`;
                    break;
                case 'linear':
                    sourceInfo = `Linear: ${sourceConfig.teamId}`;
                    break;
            }

            console.log(chalk.cyan(`  ${project.name}`));
            console.log(chalk.gray(`    Path: ${project.path}`));
            console.log(chalk.gray(`    Source: ${sourceInfo}`));
            if (project.mission) {
                console.log(chalk.gray(`    Mission: ${project.mission.slice(0, 60)}...`));
            }
            console.log('');
        }
    });

// Add project
projectsCommand
    .command('add <path>')
    .description('Add project with wizard')
    .option('--github <owner/repo>', 'Use GitHub as task source')
    .option('--jira <project>', 'Use Jira as task source')
    .option('--linear <teamId>', 'Use Linear as task source')
    .option('--name <name>', 'Project name')
    .option('--mission <mission>', 'Project mission statement')
    .action(async (pathArg: string, options) => {
        const projectPath = resolve(pathArg);

        // Verify path exists
        if (!existsSync(projectPath)) {
            console.error(chalk.red(`Path does not exist: ${projectPath}`));
            process.exit(1);
        }

        // Check if already registered
        const existing = getProjectByPath(projectPath);
        if (existing) {
            console.error(chalk.red(`Project already registered: ${existing.name}`));
            process.exit(1);
        }

        // Check for existing fleet.json
        const fleetJsonPath = join(projectPath, 'fleet.json');
        let config: Partial<FleetProjectConfig> = {};

        if (existsSync(fleetJsonPath)) {
            try {
                config = JSON.parse(readFileSync(fleetJsonPath, 'utf-8'));
                console.log(chalk.gray(`Found existing fleet.json`));
            } catch {
                // Ignore parse errors
            }
        }

        // Determine project name
        let name = options.name || config.name || basename(projectPath);
        if (!options.name && !config.name) {
            const { inputName } = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'inputName',
                    message: 'Project name:',
                    default: name,
                },
            ]);
            name = inputName;
        }

        // Determine task source
        let taskSource: TaskSourceConfig | undefined;

        if (options.github) {
            const [owner, repo] = options.github.split('/');
            taskSource = { type: 'github', owner, repo };
        } else if (options.jira) {
            taskSource = { type: 'jira', project: options.jira };
        } else if (options.linear) {
            taskSource = { type: 'linear', teamId: options.linear };
        } else if (config.taskSource) {
            taskSource = config.taskSource;
        } else {
            // Interactive wizard
            const { sourceType } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'sourceType',
                    message: 'Task source:',
                    choices: [
                        { name: 'GitHub Issues', value: 'github' },
                        { name: 'Jira', value: 'jira' },
                        { name: 'Linear', value: 'linear' },
                    ],
                },
            ]);

            if (sourceType === 'github') {
                // Try to infer from git remote
                let defaultOwnerRepo = '';
                try {
                    const { execSync } = await import('child_process');
                    const remote = execSync('git remote get-url origin', {
                        cwd: projectPath,
                        encoding: 'utf-8',
                    }).trim();
                    const match = remote.match(/github\.com[:/]([^/]+)\/([^.]+)/);
                    if (match) {
                        defaultOwnerRepo = `${match[1]}/${match[2]}`;
                    }
                } catch {
                    // Ignore
                }

                const { ownerRepo } = await inquirer.prompt([
                    {
                        type: 'input',
                        name: 'ownerRepo',
                        message: 'GitHub owner/repo:',
                        default: defaultOwnerRepo,
                        validate: (input: string) => input.includes('/') || 'Format: owner/repo',
                    },
                ]);
                const [owner, repo] = ownerRepo.split('/');
                taskSource = { type: 'github', owner, repo };
            } else if (sourceType === 'jira') {
                const { project } = await inquirer.prompt([
                    {
                        type: 'input',
                        name: 'project',
                        message: 'Jira project key:',
                        validate: (input: string) => !!input || 'Required',
                    },
                ]);
                taskSource = { type: 'jira', project };
            } else {
                const { teamId } = await inquirer.prompt([
                    {
                        type: 'input',
                        name: 'teamId',
                        message: 'Linear team ID:',
                        validate: (input: string) => !!input || 'Required',
                    },
                ]);
                taskSource = { type: 'linear', teamId };
            }
        }

        // Mission statement
        let mission = options.mission || config.mission;
        if (!mission) {
            const { inputMission } = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'inputMission',
                    message: 'Project mission (optional):',
                },
            ]);
            mission = inputMission || undefined;
        }

        // Generate ID
        const projectId = config.projectId || generateId();

        // Build full config
        const fullConfig: FleetProjectConfig = {
            projectId,
            name,
            taskSource: taskSource!,
            mission,
            agents: config.agents || defaultAgentConfig,
            approval: config.approval || defaultApprovalConfig,
            execution: config.execution || defaultExecutionConfig,
        };

        // Save fleet.json
        writeFileSync(fleetJsonPath, JSON.stringify(fullConfig, null, 2));
        console.log(chalk.gray(`Wrote ${fleetJsonPath}`));

        // Register in database
        insertProject({
            id: projectId,
            path: projectPath,
            name,
            mission: mission || null,
            task_source_type: taskSource!.type,
            task_source_config: JSON.stringify(taskSource),
            agent_config: JSON.stringify(fullConfig.agents),
            approval_config: JSON.stringify(fullConfig.approval),
            execution_config: JSON.stringify(fullConfig.execution),
        });

        console.log(chalk.green(`\n✓ Added project: ${name}`));
        console.log(chalk.gray(`Run \`fleet sync\` to pull tasks`));
    });

// Remove project
projectsCommand
    .command('remove <name>')
    .alias('rm')
    .description('Remove a project from Fleet')
    .option('-f, --force', 'Skip confirmation')
    .action(async (nameArg: string, options) => {
        const projects = getAllProjects();
        const project = projects.find(p =>
            p.name.toLowerCase() === nameArg.toLowerCase() ||
            p.id === nameArg
        );

        if (!project) {
            console.error(chalk.red(`Project not found: ${nameArg}`));
            process.exit(1);
        }

        if (!options.force) {
            const { confirm } = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'confirm',
                    message: `Remove project "${project.name}"?`,
                    default: false,
                },
            ]);

            if (!confirm) {
                console.log(chalk.gray('Cancelled'));
                return;
            }
        }

        deleteProject(project.id);
        console.log(chalk.green(`✓ Removed project: ${project.name}`));
        console.log(chalk.gray(`Note: fleet.json was not deleted from ${project.path}`));
    });
