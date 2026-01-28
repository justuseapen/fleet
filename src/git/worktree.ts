import { spawn } from 'child_process';
import { join } from 'path';
import { homedir } from 'os';
import { existsSync, readdirSync, rmSync } from 'fs';

const WORKTREES_DIR = join(homedir(), '.fleet', 'worktrees');

export interface WorktreeInfo {
    path: string;
    branch: string;
}

function runGit(cwd: string, args: string[]): Promise<{ success: boolean; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
        const git = spawn('git', args, { cwd, stdio: 'pipe' });
        let stdout = '';
        let stderr = '';

        git.stdout?.on('data', (data) => { stdout += data.toString(); });
        git.stderr?.on('data', (data) => { stderr += data.toString(); });
        git.on('error', (error) => {
            resolve({ success: false, stdout, stderr: error.message });
        });
        git.on('close', (code) => {
            resolve({ success: code === 0, stdout, stderr });
        });
    });
}

/**
 * Create a git worktree for an isolated execution.
 * Returns the worktree path and branch name.
 */
export async function createWorktree(
    projectPath: string,
    projectId: string,
    runId: string,
    branchName: string
): Promise<WorktreeInfo> {
    const worktreePath = join(WORKTREES_DIR, projectId, runId);

    // Try creating with a new branch
    const result = await runGit(projectPath, [
        'worktree', 'add', worktreePath, '-b', branchName,
    ]);

    if (result.success) {
        return { path: worktreePath, branch: branchName };
    }

    // Branch may already exist — try without -b
    if (result.stderr.includes('already exists')) {
        const fallback = await runGit(projectPath, [
            'worktree', 'add', worktreePath, branchName,
        ]);
        if (fallback.success) {
            return { path: worktreePath, branch: branchName };
        }
        throw new Error(`Failed to create worktree for existing branch '${branchName}': ${fallback.stderr}`);
    }

    throw new Error(`Failed to create worktree: ${result.stderr}`);
}

/**
 * Remove a git worktree and prune stale entries.
 */
export async function removeWorktree(projectPath: string, worktreePath: string): Promise<void> {
    await runGit(projectPath, ['worktree', 'remove', '--force', worktreePath]);
    await runGit(projectPath, ['worktree', 'prune']);
}

/**
 * Clean up orphaned worktrees from crashed or interrupted runs.
 * Removes any worktree directories under the project's worktree folder
 * that are not in the activeRunIds set.
 */
export async function cleanupOrphanedWorktrees(
    projectPath: string,
    projectId: string,
    activeRunIds: Set<string>
): Promise<string[]> {
    const projectWorktreeDir = join(WORKTREES_DIR, projectId);
    if (!existsSync(projectWorktreeDir)) {
        return [];
    }

    const removed: string[] = [];
    const entries = readdirSync(projectWorktreeDir);

    for (const entry of entries) {
        if (activeRunIds.has(entry)) {
            continue;
        }
        const worktreePath = join(projectWorktreeDir, entry);
        await removeWorktree(projectPath, worktreePath);
        // If the directory still exists after git worktree remove, force-delete it
        if (existsSync(worktreePath)) {
            rmSync(worktreePath, { recursive: true, force: true });
        }
        removed.push(entry);
    }

    return removed;
}
