import { spawn } from 'child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { Agent, AgentContext, AgentResult } from './base.js';
import type { PrdJson, ExecutionConfig } from '../types.js';
import type { Run } from '../db/index.js';
import {
    updateRun,
    insertWorkLog,
    generateId,
    updateTaskStatus,
    updatePrdStatus,
} from '../db/index.js';
import { logEvent } from '../logging/index.js';

const OUTPUT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes of no output
const TIMEOUT_CHECK_INTERVAL_MS = 30_000; // Check every 30 seconds

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

            const branchName = prdJson.branchName || `fleet/${run.id}`;

            // Update run status
            const now = new Date().toISOString();
            updateRun(run.id, {
                status: 'running',
                started_at: now,
                last_progress_at: now,
            });

            logEvent({
                level: 'info',
                runId: run.id,
                projectId: project.id,
                message: 'Starting Ralph loop',
                details: { branch: branchName, iterations: executionConfig.defaultIterations },
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
                project.path,
                executionConfig.tool,
                executionConfig.defaultIterations,
                run.id,
                project.id
            );

            // Update final status
            const success = result.exitCode === 0;

            if (!success) {
                // Capture debug info on failure
                const diagPath = this.captureDebugInfo(workDir, run, result);
                logEvent({
                    level: 'error',
                    runId: run.id,
                    projectId: project.id,
                    message: `Ralph failed: ${result.error}`,
                    details: {
                        iterations: result.iterations,
                        storiesCompleted: result.storiesCompleted,
                        timedOut: result.timedOut,
                        diagnosticsPath: diagPath,
                    },
                });
            }

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

                logEvent({
                    level: 'info',
                    runId: run.id,
                    projectId: project.id,
                    message: `Completed in ${result.iterations} iterations`,
                    details: { storiesCompleted: result.storiesCompleted },
                });

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
                    details: JSON.stringify({
                        iterations: result.iterations,
                        error: result.error,
                        timedOut: result.timedOut,
                        storiesCompleted: result.storiesCompleted,
                    }),
                });
            }

            return {
                success,
                output: success ? `Completed in ${result.iterations} iterations` : undefined,
                error: success ? undefined : result.error,
                artifacts: {
                    branch: branchName,
                    iterations: result.iterations,
                    storiesCompleted: result.storiesCompleted,
                },
            };
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);

            logEvent({
                level: 'error',
                runId: run.id,
                projectId: project.id,
                message: `Unhandled error: ${errorMsg}`,
            });

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

    private async spawnRalph(
        workDir: string,
        projectPath: string,
        tool: string,
        maxIterations: number,
        runId: string,
        projectId: string
    ): Promise<{ exitCode: number; iterations: number; storiesCompleted: number; timedOut: boolean; error?: string }> {
        return new Promise((resolve) => {
            // Look for ralph.sh in known locations - check both worktree and original project path
            // (ralph.sh may be untracked and not present in the worktree)
            const searchPaths = [
                join(workDir, 'ralph.sh'),
                join(workDir, 'scripts', 'ralph', 'ralph.sh'),
                join(workDir, 'scripts', 'ralph.sh'),
                join(projectPath, 'ralph.sh'),
                join(projectPath, 'scripts', 'ralph', 'ralph.sh'),
                join(projectPath, 'scripts', 'ralph.sh'),
            ];

            const ralphScript = searchPaths.find((p) => existsSync(p));

            if (!ralphScript) {
                resolve({
                    exitCode: 1,
                    iterations: 0,
                    storiesCompleted: 0,
                    timedOut: false,
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
            let storiesCompleted = 0;
            let lastOutputTime = Date.now();
            let timedOut = false;

            ralph.stdout?.on('data', (data) => {
                const output = data.toString();
                stdout += output;
                lastOutputTime = Date.now();

                // Parse iteration count from Ralph output
                const iterMatch = output.match(/Iteration (\d+)/);
                if (iterMatch) {
                    iterations = parseInt(iterMatch[1], 10);
                    updateRun(runId, {
                        iterations_completed: iterations,
                        last_progress_at: new Date().toISOString(),
                    });
                }

                // Parse story completion from output
                if (output.match(/passes.*true/i) || output.match(/feat:.*US-\d+/i)) {
                    storiesCompleted++;
                    updateRun(runId, {
                        last_progress_at: new Date().toISOString(),
                    });
                    logEvent({
                        level: 'info',
                        runId,
                        projectId,
                        message: `Story completed (${storiesCompleted} total)`,
                        details: { iterations },
                    });
                }

                // Check for completion signal
                if (output.includes('<promise>COMPLETE</promise>')) {
                    ralph.kill('SIGTERM');
                }
            });

            ralph.stderr?.on('data', (data) => {
                stderr += data.toString();
                lastOutputTime = Date.now();
            });

            // Output timeout checker — kills Ralph if no output for OUTPUT_TIMEOUT_MS
            const timeoutChecker = setInterval(() => {
                const silenceMs = Date.now() - lastOutputTime;
                if (silenceMs > OUTPUT_TIMEOUT_MS) {
                    clearInterval(timeoutChecker);
                    timedOut = true;

                    logEvent({
                        level: 'warn',
                        runId,
                        projectId,
                        message: `Output timeout: no output for ${Math.round(silenceMs / 60000)} minutes, killing process`,
                        details: { iterations, storiesCompleted, silenceMs },
                    });

                    ralph.kill('SIGTERM');
                    // Force kill after 5 seconds if SIGTERM doesn't work
                    setTimeout(() => {
                        try { ralph.kill('SIGKILL'); } catch { /* already dead */ }
                    }, 5000);
                }
            }, TIMEOUT_CHECK_INTERVAL_MS);

            ralph.on('close', (code) => {
                clearInterval(timeoutChecker);
                const success = code === 0 || stdout.includes('<promise>COMPLETE</promise>');
                resolve({
                    exitCode: success ? 0 : (code || 1),
                    iterations,
                    storiesCompleted,
                    timedOut,
                    error: success ? undefined : (timedOut ? `Output timeout: no output for ${OUTPUT_TIMEOUT_MS / 60000} minutes` : (stderr || 'Ralph execution failed')),
                });
            });

            ralph.on('error', (error) => {
                clearInterval(timeoutChecker);
                resolve({
                    exitCode: 1,
                    iterations,
                    storiesCompleted: 0,
                    timedOut: false,
                    error: `Failed to spawn bash: ${error.message}`,
                });
            });
        });
    }

    private captureDebugInfo(
        workDir: string,
        run: Run,
        result: { iterations: number; storiesCompleted: number; timedOut: boolean; error?: string }
    ): string | undefined {
        try {
            const diagnostics: Record<string, unknown> = {
                runId: run.id,
                projectId: run.project_id,
                branch: run.branch,
                iterations: result.iterations,
                storiesCompleted: result.storiesCompleted,
                timedOut: result.timedOut,
                error: result.error,
                startedAt: run.started_at,
                failedAt: new Date().toISOString(),
            };

            // Read last lines of progress.txt
            const progressPath = join(workDir, 'progress.txt');
            if (existsSync(progressPath)) {
                const content = readFileSync(progressPath, 'utf-8');
                const lines = content.split('\n');
                diagnostics.lastProgressLines = lines.slice(-20).join('\n');
            }

            // Read prd.json state
            const prdPath = join(workDir, 'prd.json');
            if (existsSync(prdPath)) {
                const prdJson: PrdJson = JSON.parse(readFileSync(prdPath, 'utf-8'));
                const total = prdJson.userStories.length;
                const passed = prdJson.userStories.filter(s => s.passes).length;
                diagnostics.storiesPassed = `${passed}/${total}`;
                diagnostics.remainingStories = prdJson.userStories
                    .filter(s => !s.passes)
                    .map(s => `${s.id}: ${s.title}`);
            }

            const diagPath = join(workDir, 'debug-info.json');
            writeFileSync(diagPath, JSON.stringify(diagnostics, null, 2));
            return diagPath;
        } catch {
            // Best-effort — don't fail if diagnostics can't be captured
            return undefined;
        }
    }
}
