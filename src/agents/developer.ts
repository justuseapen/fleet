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
                if (context.task) {
                    updateTaskStatus(context.task.id, 'completed');
                }
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
                if (context.task) {
                    updateTaskStatus(context.task.id, 'failed');
                }

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

    /**
     * Run a git command and return { success, stdout, stderr }
     */
    private runGit(workDir: string, args: string[]): Promise<{ success: boolean; stdout: string; stderr: string }> {
        return new Promise((resolve) => {
            const git = spawn('git', args, {
                cwd: workDir,
                stdio: 'pipe',
            });

            let stdout = '';
            let stderr = '';

            git.stdout?.on('data', (data) => {
                stdout += data.toString();
            });

            git.stderr?.on('data', (data) => {
                stderr += data.toString();
            });

            git.on('error', (error) => {
                resolve({ success: false, stdout, stderr: error.message });
            });

            git.on('close', (code) => {
                resolve({ success: code === 0, stdout, stderr });
            });
        });
    }

    /**
     * Check if there are uncommitted changes in the working directory
     */
    private async hasUncommittedChanges(workDir: string): Promise<boolean> {
        const result = await this.runGit(workDir, ['status', '--porcelain']);
        return result.stdout.trim().length > 0;
    }

    private async createBranch(workDir: string, branchName: string): Promise<void> {
        // Check for uncommitted changes and stash if needed
        const hasChanges = await this.hasUncommittedChanges(workDir);
        let stashed = false;

        if (hasChanges) {
            const stashResult = await this.runGit(workDir, ['stash', 'push', '-m', `Fleet auto-stash for ${branchName}`]);
            if (!stashResult.success) {
                throw new Error(`Failed to stash uncommitted changes: ${stashResult.stderr}`);
            }
            stashed = true;
        }

        try {
            // Try to create the branch
            const createResult = await this.runGit(workDir, ['checkout', '-b', branchName]);

            if (createResult.success) {
                return;
            }

            // Branch might already exist locally or on remote
            if (createResult.stderr.includes('already exists')) {
                // Try checking out existing local branch
                const checkoutResult = await this.runGit(workDir, ['checkout', branchName]);
                if (checkoutResult.success) {
                    return;
                }
            }

            // Try fetching from remote and checking out
            await this.runGit(workDir, ['fetch', 'origin', branchName]);
            const checkoutRemoteResult = await this.runGit(workDir, ['checkout', branchName]);
            if (checkoutRemoteResult.success) {
                return;
            }

            // If all else fails, provide actionable error message
            throw new Error(
                `Failed to checkout branch '${branchName}'. ` +
                `Error: ${createResult.stderr.trim()}. ` +
                `Try running 'git checkout ${branchName}' manually to diagnose.`
            );
        } finally {
            // Restore stashed changes if we stashed them
            if (stashed) {
                await this.runGit(workDir, ['stash', 'pop']);
            }
        }
    }

    private async spawnRalph(
        workDir: string,
        tool: string,
        maxIterations: number
    ): Promise<{ exitCode: number; iterations: number; error?: string }> {
        return new Promise((resolve) => {
            // Look for ralph.sh in known locations
            const searchPaths = [
                join(workDir, 'ralph.sh'),
                join(workDir, 'scripts', 'ralph', 'ralph.sh'),
                join(workDir, 'scripts', 'ralph.sh'),
            ];

            const ralphScript = searchPaths.find((p) => existsSync(p));

            if (!ralphScript) {
                resolve({
                    exitCode: 1,
                    iterations: 0,
                    error: `ralph.sh not found. Searched paths:\n${searchPaths.map((p) => `  - ${p}`).join('\n')}\n\nCreate ralph.sh in your project root or scripts/ directory.`,
                });
                return;
            }

            // Use 'bash' to execute the script - avoids shebang/permission issues
            const args = [ralphScript, '--tool', tool, String(maxIterations)];

            const ralph = spawn('bash', args, {
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
                    error: `Failed to spawn bash: ${error.message}`,
                });
            });
        });
    }
}
