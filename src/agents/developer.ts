import { spawn, type ChildProcess } from 'child_process';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import type { Agent, AgentContext, AgentResult } from './base.js';
import type { PrdJson, ExecutionConfig } from '../types.js';
import {
    updateRun,
    insertWorkLog,
    generateId,
    updateTaskStatus,
    updatePrdStatus,
} from '../db/index.js';

/**
 * Developer agent that spawns Ralph loops to execute PRDs
 */
export class DeveloperAgent implements Agent {
    name = 'developer';
    description = 'Executes PRDs via Ralph autonomous loops';

    async execute(context: AgentContext): Promise<AgentResult> {
        const { project, prd, run, workDir } = context;

        if (!prd || !run) {
            return {
                success: false,
                error: 'No PRD or run provided to developer agent',
            };
        }

        const executionConfig: ExecutionConfig = JSON.parse(project.execution_config);
        const prdJson: PrdJson = JSON.parse(prd.prd_json);

        try {
            // Set up workspace
            await this.setupWorkspace(workDir, prdJson, prd.content);

            // Create branch
            const branchName = prdJson.branchName || `fleet/${run.id}`;
            await this.createBranch(workDir, branchName);

            // Update run status
            updateRun(run.id, {
                status: 'running',
                started_at: new Date().toISOString(),
            });

            insertWorkLog({
                id: generateId(),
                run_id: run.id,
                project_id: project.id,
                event_type: 'started',
                summary: `Started Ralph loop for ${prdJson.description}`,
                details: JSON.stringify({ branch: branchName, iterations: executionConfig.defaultIterations }),
            });

            // Spawn Ralph
            const result = await this.spawnRalph(
                workDir,
                executionConfig.tool,
                executionConfig.defaultIterations
            );

            // Update final status
            const success = result.exitCode === 0;
            updateRun(run.id, {
                status: success ? 'completed' : 'failed',
                completed_at: new Date().toISOString(),
                iterations_completed: result.iterations,
                error: success ? null : result.error,
            });

            if (success) {
                updateTaskStatus(context.task!.id, 'completed');
                updatePrdStatus(prd.id, 'executed');

                insertWorkLog({
                    id: generateId(),
                    run_id: run.id,
                    project_id: project.id,
                    event_type: 'completed',
                    summary: `Completed ${prdJson.description}`,
                    details: JSON.stringify({ iterations: result.iterations }),
                });
            } else {
                updateTaskStatus(context.task!.id, 'failed');

                insertWorkLog({
                    id: generateId(),
                    run_id: run.id,
                    project_id: project.id,
                    event_type: 'failed',
                    summary: `Failed: ${result.error}`,
                    details: JSON.stringify({ iterations: result.iterations, error: result.error }),
                });
            }

            return {
                success,
                output: success ? `Completed in ${result.iterations} iterations` : undefined,
                error: success ? undefined : result.error,
                artifacts: {
                    branch: branchName,
                    iterations: result.iterations,
                },
            };
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);

            updateRun(run.id, {
                status: 'failed',
                completed_at: new Date().toISOString(),
                error: errorMsg,
            });

            return {
                success: false,
                error: errorMsg,
            };
        }
    }

    private async setupWorkspace(workDir: string, prdJson: PrdJson, prdContent: string): Promise<void> {
        const tasksDir = join(workDir, 'tasks');
        if (!existsSync(tasksDir)) {
            mkdirSync(tasksDir, { recursive: true });
        }

        // Write prd.json
        writeFileSync(
            join(workDir, 'prd.json'),
            JSON.stringify(prdJson, null, 2)
        );

        // Write full PRD content
        const prdFileName = `prd-${prdJson.branchName.replace('fleet/', '')}.md`;
        writeFileSync(
            join(tasksDir, prdFileName),
            prdContent
        );

        // Initialize progress.txt if it doesn't exist
        const progressPath = join(workDir, 'progress.txt');
        if (!existsSync(progressPath)) {
            writeFileSync(progressPath, `# Progress Log\n\n## ${new Date().toISOString()}\nInitialized by Fleet\n`);
        }
    }

    private async createBranch(workDir: string, branchName: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const git = spawn('git', ['checkout', '-b', branchName], {
                cwd: workDir,
                stdio: 'pipe',
            });

            let stderr = '';
            git.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            git.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else if (stderr.includes('already exists')) {
                    // Branch exists, just check it out
                    const checkout = spawn('git', ['checkout', branchName], {
                        cwd: workDir,
                        stdio: 'pipe',
                    });
                    checkout.on('close', (checkoutCode) => {
                        if (checkoutCode === 0) {
                            resolve();
                        } else {
                            reject(new Error(`Failed to checkout branch: ${branchName}`));
                        }
                    });
                } else {
                    reject(new Error(`Failed to create branch: ${stderr}`));
                }
            });
        });
    }

    private async spawnRalph(
        workDir: string,
        tool: string,
        maxIterations: number
    ): Promise<{ exitCode: number; iterations: number; error?: string }> {
        return new Promise((resolve) => {
            // Look for ralph.sh in the project or use global
            const ralphScript = existsSync(join(workDir, 'ralph.sh'))
                ? join(workDir, 'ralph.sh')
                : existsSync(join(workDir, 'scripts', 'ralph', 'ralph.sh'))
                    ? join(workDir, 'scripts', 'ralph', 'ralph.sh')
                    : 'ralph'; // Assume it's in PATH

            const ralph = spawn(ralphScript, ['--tool', tool, String(maxIterations)], {
                cwd: workDir,
                stdio: ['inherit', 'pipe', 'pipe'],
                env: {
                    ...process.env,
                    FLEET_MANAGED: '1',
                },
            });

            let stdout = '';
            let stderr = '';
            let iterations = 0;

            ralph.stdout?.on('data', (data) => {
                const output = data.toString();
                stdout += output;

                // Parse iteration count from Ralph output
                const iterMatch = output.match(/Iteration (\d+)/);
                if (iterMatch) {
                    iterations = parseInt(iterMatch[1], 10);
                }

                // Check for completion signal
                if (output.includes('<promise>COMPLETE</promise>')) {
                    ralph.kill('SIGTERM');
                }
            });

            ralph.stderr?.on('data', (data) => {
                stderr += data.toString();
            });

            ralph.on('close', (code) => {
                const success = code === 0 || stdout.includes('<promise>COMPLETE</promise>');
                resolve({
                    exitCode: success ? 0 : (code || 1),
                    iterations,
                    error: success ? undefined : stderr || 'Ralph execution failed',
                });
            });

            ralph.on('error', (error) => {
                resolve({
                    exitCode: 1,
                    iterations,
                    error: error.message,
                });
            });
        });
    }
}
