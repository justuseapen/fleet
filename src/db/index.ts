import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { mkdirSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const FLEET_DIR = join(homedir(), '.fleet');
const DB_PATH = join(FLEET_DIR, 'fleet.db');

// Ensure .fleet directory exists
if (!existsSync(FLEET_DIR)) {
    mkdirSync(FLEET_DIR, { recursive: true });
}

let db: Database.Database | null = null;

export function getDb(): Database.Database {
    if (!db) {
        db = new Database(DB_PATH);
        db.pragma('journal_mode = WAL');
        initializeSchema(db);
    }
    return db;
}

function initializeSchema(database: Database.Database): void {
    const schemaPath = join(__dirname, 'schema.sql');
    const schema = readFileSync(schemaPath, 'utf-8');
    database.exec(schema);

    // Migrations for existing databases
    try {
        database.exec('ALTER TABLE runs ADD COLUMN worktree_path TEXT');
    } catch {
        // Column already exists — ignore
    }
    try {
        database.exec('ALTER TABLE runs ADD COLUMN last_progress_at TEXT');
    } catch {
        // Column already exists — ignore
    }
    try {
        database.exec('ALTER TABLE runs ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0');
    } catch {
        // Column already exists — ignore
    }
}

export function closeDb(): void {
    if (db) {
        db.close();
        db = null;
    }
}

// Helper to generate UUIDs
export function generateId(): string {
    return randomUUID();
}

// Type-safe query helpers
export interface Project {
    id: string;
    path: string;
    name: string;
    mission: string | null;
    task_source_type: 'jira' | 'github' | 'linear';
    task_source_config: string;
    agent_config: string;
    approval_config: string;
    execution_config: string;
    created_at: string;
    updated_at: string;
}

export interface Task {
    id: string;
    project_id: string;
    external_id: string;
    external_url: string | null;
    title: string;
    description: string | null;
    task_type: 'bug' | 'feature' | 'chore' | 'refactor';
    priority: 'low' | 'medium' | 'high' | 'critical' | null;
    status: 'backlog' | 'planning' | 'approved' | 'running' | 'completed' | 'failed';
    labels: string | null;
    assignee: string | null;
    synced_at: string;
    created_at: string;
    updated_at: string;
}

export interface Prd {
    id: string;
    task_id: string | null;
    proposal_id: string | null;
    project_id: string;
    content: string;
    prd_json: string;
    risk_score: number;
    risk_factors: string | null;
    status: 'pending' | 'approved' | 'rejected' | 'executed';
    approved_at: string | null;
    approved_by: string | null;
    created_at: string;
    updated_at: string;
}

export interface Run {
    id: string;
    prd_id: string;
    project_id: string;
    branch: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    iterations_planned: number;
    iterations_completed: number;
    started_at: string | null;
    completed_at: string | null;
    error: string | null;
    pr_url: string | null;
    worktree_path: string | null;
    last_progress_at: string | null;
    retry_count: number;
    created_at: string;
    updated_at: string;
}

export interface WorkLog {
    id: string;
    run_id: string | null;
    project_id: string;
    event_type: 'started' | 'completed' | 'failed' | 'pr_created' | 'approved' | 'rejected';
    summary: string;
    details: string | null;
    created_at: string;
}

export interface Audit {
    id: string;
    project_id: string | null;
    report: string;
    recommendations: string | null;
    scope_creep_detected: number;
    created_at: string;
}

export interface Proposal {
    id: string;
    project_id: string;
    title: string;
    rationale: string | null;
    source_context: string | null;
    status: 'proposed' | 'approved' | 'rejected' | 'converted';
    converted_task_id: string | null;
    created_at: string;
    updated_at: string;
}

// Agent collaboration types
export interface AgentContext {
    id: string;
    project_id: string;
    run_id: string | null;
    agent_name: string;
    context_key: string;
    context_value: string;
    context_type: 'general' | 'handoff' | 'validation' | 'artifact';
    expires_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface AgentHandoff {
    id: string;
    project_id: string;
    run_id: string | null;
    from_agent: string;
    to_agent: string;
    handoff_type: 'sequential' | 'parallel' | 'callback';
    status: 'pending' | 'accepted' | 'completed' | 'failed' | 'rejected';
    payload: string;
    result: string | null;
    priority: number;
    accepted_at: string | null;
    completed_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface AgentValidation {
    id: string;
    project_id: string;
    run_id: string | null;
    prd_id: string | null;
    validation_type: 'code_review' | 'risk_assessment' | 'quality_check' | 'security_scan';
    validator_agent: string;
    target_agent: string | null;
    target_artifact: string | null;
    status: 'pending' | 'in_progress' | 'passed' | 'failed' | 'needs_revision';
    verdict: 'approve' | 'reject' | 'request_changes' | null;
    findings: string | null;
    severity: 'info' | 'warning' | 'error' | 'critical' | null;
    created_at: string;
    completed_at: string | null;
}

// Project queries
export function getAllProjects(): Project[] {
    return getDb().prepare('SELECT * FROM projects ORDER BY name').all() as Project[];
}

export function getProjectById(id: string): Project | undefined {
    return getDb().prepare('SELECT * FROM projects WHERE id = ?').get(id) as Project | undefined;
}

export function getProjectByPath(path: string): Project | undefined {
    return getDb().prepare('SELECT * FROM projects WHERE path = ?').get(path) as Project | undefined;
}

export function insertProject(project: Omit<Project, 'created_at' | 'updated_at'>): void {
    getDb().prepare(`
        INSERT INTO projects (id, path, name, mission, task_source_type, task_source_config, agent_config, approval_config, execution_config)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        project.id,
        project.path,
        project.name,
        project.mission,
        project.task_source_type,
        project.task_source_config,
        project.agent_config,
        project.approval_config,
        project.execution_config
    );
}

export function deleteProject(id: string): void {
    getDb().prepare('DELETE FROM projects WHERE id = ?').run(id);
}

// Task queries
export function getTasksByProject(projectId: string): Task[] {
    return getDb().prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY priority DESC, created_at DESC').all(projectId) as Task[];
}

export function getTasksByStatus(status: Task['status']): Task[] {
    return getDb().prepare('SELECT * FROM tasks WHERE status = ? ORDER BY priority DESC, created_at DESC').all(status) as Task[];
}

export function getTaskById(id: string): Task | undefined {
    return getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Task | undefined;
}

export function getTaskByExternalId(projectId: string, externalId: string): Task | undefined {
    return getDb().prepare('SELECT * FROM tasks WHERE project_id = ? AND external_id = ?').get(projectId, externalId) as Task | undefined;
}

export function upsertTask(task: Omit<Task, 'created_at' | 'updated_at'>): void {
    getDb().prepare(`
        INSERT INTO tasks (id, project_id, external_id, external_url, title, description, task_type, priority, status, labels, assignee, synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(project_id, external_id) DO UPDATE SET
            title = excluded.title,
            description = excluded.description,
            task_type = excluded.task_type,
            priority = excluded.priority,
            labels = excluded.labels,
            assignee = excluded.assignee,
            synced_at = excluded.synced_at,
            updated_at = datetime('now')
    `).run(
        task.id,
        task.project_id,
        task.external_id,
        task.external_url,
        task.title,
        task.description,
        task.task_type,
        task.priority,
        task.status,
        task.labels,
        task.assignee,
        task.synced_at
    );
}

export function updateTaskStatus(id: string, status: Task['status']): void {
    getDb().prepare('UPDATE tasks SET status = ?, updated_at = datetime(\'now\') WHERE id = ?').run(status, id);
}

// PRD queries
export function getPrdsByStatus(status: Prd['status']): Prd[] {
    return getDb().prepare('SELECT * FROM prds WHERE status = ? ORDER BY risk_score DESC, created_at DESC').all(status) as Prd[];
}

export function getPrdById(id: string): Prd | undefined {
    return getDb().prepare('SELECT * FROM prds WHERE id = ?').get(id) as Prd | undefined;
}

export function getPrdByTaskId(taskId: string): Prd | undefined {
    return getDb().prepare('SELECT * FROM prds WHERE task_id = ? ORDER BY created_at DESC LIMIT 1').get(taskId) as Prd | undefined;
}

export function insertPrd(prd: Omit<Prd, 'created_at' | 'updated_at'>): void {
    getDb().prepare(`
        INSERT INTO prds (id, task_id, proposal_id, project_id, content, prd_json, risk_score, risk_factors, status, approved_at, approved_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        prd.id,
        prd.task_id,
        prd.proposal_id,
        prd.project_id,
        prd.content,
        prd.prd_json,
        prd.risk_score,
        prd.risk_factors,
        prd.status,
        prd.approved_at,
        prd.approved_by
    );
}

export function updatePrdStatus(id: string, status: Prd['status'], approvedBy?: string): void {
    if (status === 'approved' && approvedBy) {
        getDb().prepare('UPDATE prds SET status = ?, approved_at = datetime(\'now\'), approved_by = ?, updated_at = datetime(\'now\') WHERE id = ?')
            .run(status, approvedBy, id);
    } else {
        getDb().prepare('UPDATE prds SET status = ?, updated_at = datetime(\'now\') WHERE id = ?').run(status, id);
    }
}

// Run queries
export function getRunsByStatus(status: Run['status']): Run[] {
    return getDb().prepare('SELECT * FROM runs WHERE status = ? ORDER BY created_at DESC').all(status) as Run[];
}

export function getRunById(id: string): Run | undefined {
    return getDb().prepare('SELECT * FROM runs WHERE id = ?').get(id) as Run | undefined;
}

export function getRunsByProject(projectId: string): Run[] {
    return getDb().prepare('SELECT * FROM runs WHERE project_id = ? ORDER BY created_at DESC').all(projectId) as Run[];
}

export function insertRun(run: Omit<Run, 'created_at' | 'updated_at'>): void {
    getDb().prepare(`
        INSERT INTO runs (id, prd_id, project_id, branch, status, iterations_planned, iterations_completed, started_at, completed_at, error, pr_url, worktree_path, last_progress_at, retry_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        run.id,
        run.prd_id,
        run.project_id,
        run.branch,
        run.status,
        run.iterations_planned,
        run.iterations_completed,
        run.started_at,
        run.completed_at,
        run.error,
        run.pr_url,
        run.worktree_path,
        run.last_progress_at,
        run.retry_count
    );
}

export function updateRun(id: string, updates: Partial<Pick<Run, 'status' | 'iterations_completed' | 'started_at' | 'completed_at' | 'error' | 'pr_url' | 'worktree_path' | 'last_progress_at' | 'retry_count'>>): void {
    const setClauses: string[] = ['updated_at = datetime(\'now\')'];
    const values: (string | number | null)[] = [];

    if (updates.status !== undefined) {
        setClauses.push('status = ?');
        values.push(updates.status);
    }
    if (updates.iterations_completed !== undefined) {
        setClauses.push('iterations_completed = ?');
        values.push(updates.iterations_completed);
    }
    if (updates.started_at !== undefined) {
        setClauses.push('started_at = ?');
        values.push(updates.started_at);
    }
    if (updates.completed_at !== undefined) {
        setClauses.push('completed_at = ?');
        values.push(updates.completed_at);
    }
    if (updates.error !== undefined) {
        setClauses.push('error = ?');
        values.push(updates.error);
    }
    if (updates.pr_url !== undefined) {
        setClauses.push('pr_url = ?');
        values.push(updates.pr_url);
    }
    if (updates.worktree_path !== undefined) {
        setClauses.push('worktree_path = ?');
        values.push(updates.worktree_path);
    }
    if (updates.last_progress_at !== undefined) {
        setClauses.push('last_progress_at = ?');
        values.push(updates.last_progress_at);
    }
    if (updates.retry_count !== undefined) {
        setClauses.push('retry_count = ?');
        values.push(updates.retry_count);
    }

    values.push(id);
    getDb().prepare(`UPDATE runs SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
}

// Work log queries
export function insertWorkLog(log: Omit<WorkLog, 'created_at'>): void {
    getDb().prepare(`
        INSERT INTO work_log (id, run_id, project_id, event_type, summary, details)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(log.id, log.run_id, log.project_id, log.event_type, log.summary, log.details);
}

export function getWorkLogSince(since: string): WorkLog[] {
    return getDb().prepare('SELECT * FROM work_log WHERE created_at >= ? ORDER BY created_at DESC').all(since) as WorkLog[];
}

export function getWorkLogByProject(projectId: string, limit = 50): WorkLog[] {
    return getDb().prepare('SELECT * FROM work_log WHERE project_id = ? ORDER BY created_at DESC LIMIT ?').all(projectId, limit) as WorkLog[];
}

// Audit queries
export function insertAudit(audit: Omit<Audit, 'created_at'>): void {
    getDb().prepare(`
        INSERT INTO audits (id, project_id, report, recommendations, scope_creep_detected)
        VALUES (?, ?, ?, ?, ?)
    `).run(audit.id, audit.project_id, audit.report, audit.recommendations, audit.scope_creep_detected);
}

export function getLatestAudit(projectId?: string): Audit | undefined {
    if (projectId) {
        return getDb().prepare('SELECT * FROM audits WHERE project_id = ? ORDER BY created_at DESC LIMIT 1').get(projectId) as Audit | undefined;
    }
    return getDb().prepare('SELECT * FROM audits WHERE project_id IS NULL ORDER BY created_at DESC LIMIT 1').get() as Audit | undefined;
}

// Proposal queries
export function insertProposal(proposal: Omit<Proposal, 'created_at' | 'updated_at'>): void {
    getDb().prepare(`
        INSERT INTO proposals (id, project_id, title, rationale, source_context, status, converted_task_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
        proposal.id,
        proposal.project_id,
        proposal.title,
        proposal.rationale,
        proposal.source_context,
        proposal.status,
        proposal.converted_task_id
    );
}

export function getProposalsByProject(projectId: string): Proposal[] {
    return getDb().prepare('SELECT * FROM proposals WHERE project_id = ? ORDER BY created_at DESC').all(projectId) as Proposal[];
}

export function getProposalsByStatus(status: Proposal['status']): Proposal[] {
    return getDb().prepare('SELECT * FROM proposals WHERE status = ? ORDER BY created_at DESC').all(status) as Proposal[];
}

export function getProposalById(id: string): Proposal | undefined {
    return getDb().prepare('SELECT * FROM proposals WHERE id = ?').get(id) as Proposal | undefined;
}

export function updateProposalStatus(id: string, status: Proposal['status'], convertedTaskId?: string): void {
    if (status === 'converted' && convertedTaskId) {
        getDb().prepare('UPDATE proposals SET status = ?, converted_task_id = ?, updated_at = datetime(\'now\') WHERE id = ?')
            .run(status, convertedTaskId, id);
    } else {
        getDb().prepare('UPDATE proposals SET status = ?, updated_at = datetime(\'now\') WHERE id = ?').run(status, id);
    }
}

// Cleanup queries
export function getStaleRuns(staleThresholdMinutes = 60): Run[] {
    return getDb().prepare(`
        SELECT * FROM runs
        WHERE status = 'running'
          AND datetime(started_at, '+' || ? || ' minutes') < datetime('now')
    `).all(staleThresholdMinutes) as Run[];
}

export function markStaleRunsAsFailed(staleThresholdMinutes = 60): number {
    const result = getDb().prepare(`
        UPDATE runs
        SET status = 'failed',
            error = 'Marked as failed: stale run with no progress (threshold: ' || ? || ' minutes)',
            completed_at = datetime('now'),
            updated_at = datetime('now')
        WHERE status = 'running'
          AND datetime(started_at, '+' || ? || ' minutes') < datetime('now')
    `).run(staleThresholdMinutes, staleThresholdMinutes);
    return result.changes;
}

export function getOldFailedRuns(olderThanDays = 7): Run[] {
    return getDb().prepare(`
        SELECT * FROM runs
        WHERE status = 'failed'
          AND datetime(created_at, '+' || ? || ' days') < datetime('now')
    `).all(olderThanDays) as Run[];
}

export function clearOldFailedRuns(olderThanDays = 7): number {
    const result = getDb().prepare(`
        DELETE FROM runs
        WHERE status = 'failed'
          AND datetime(created_at, '+' || ? || ' days') < datetime('now')
    `).run(olderThanDays);
    return result.changes;
}

// Agent Context queries (Shared Context Store)
export function setAgentContext(context: Omit<AgentContext, 'created_at' | 'updated_at'>): void {
    getDb().prepare(`
        INSERT INTO agent_contexts (id, project_id, run_id, agent_name, context_key, context_value, context_type, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(project_id, run_id, context_key) DO UPDATE SET
            agent_name = excluded.agent_name,
            context_value = excluded.context_value,
            context_type = excluded.context_type,
            expires_at = excluded.expires_at,
            updated_at = datetime('now')
    `).run(
        context.id,
        context.project_id,
        context.run_id,
        context.agent_name,
        context.context_key,
        context.context_value,
        context.context_type,
        context.expires_at
    );
}

export function getAgentContext(projectId: string, contextKey: string, runId?: string): AgentContext | undefined {
    if (runId) {
        return getDb().prepare(`
            SELECT * FROM agent_contexts
            WHERE project_id = ? AND context_key = ? AND run_id = ?
              AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
        `).get(projectId, contextKey, runId) as AgentContext | undefined;
    }
    return getDb().prepare(`
        SELECT * FROM agent_contexts
        WHERE project_id = ? AND context_key = ? AND run_id IS NULL
          AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
    `).get(projectId, contextKey) as AgentContext | undefined;
}

export function getAgentContextsByType(projectId: string, contextType: AgentContext['context_type'], runId?: string): AgentContext[] {
    if (runId) {
        return getDb().prepare(`
            SELECT * FROM agent_contexts
            WHERE project_id = ? AND context_type = ? AND run_id = ?
              AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
            ORDER BY created_at DESC
        `).all(projectId, contextType, runId) as AgentContext[];
    }
    return getDb().prepare(`
        SELECT * FROM agent_contexts
        WHERE project_id = ? AND context_type = ?
          AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
        ORDER BY created_at DESC
    `).all(projectId, contextType) as AgentContext[];
}

export function getAgentContextsByAgent(projectId: string, agentName: string): AgentContext[] {
    return getDb().prepare(`
        SELECT * FROM agent_contexts
        WHERE project_id = ? AND agent_name = ?
          AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
        ORDER BY created_at DESC
    `).all(projectId, agentName) as AgentContext[];
}

export function getAllAgentContexts(projectId: string, runId?: string): AgentContext[] {
    if (runId) {
        return getDb().prepare(`
            SELECT * FROM agent_contexts
            WHERE project_id = ? AND (run_id = ? OR run_id IS NULL)
              AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
            ORDER BY created_at DESC
        `).all(projectId, runId) as AgentContext[];
    }
    return getDb().prepare(`
        SELECT * FROM agent_contexts
        WHERE project_id = ?
          AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
        ORDER BY created_at DESC
    `).all(projectId) as AgentContext[];
}

export function deleteAgentContext(projectId: string, contextKey: string, runId?: string): void {
    if (runId) {
        getDb().prepare('DELETE FROM agent_contexts WHERE project_id = ? AND context_key = ? AND run_id = ?')
            .run(projectId, contextKey, runId);
    } else {
        getDb().prepare('DELETE FROM agent_contexts WHERE project_id = ? AND context_key = ? AND run_id IS NULL')
            .run(projectId, contextKey);
    }
}

export function cleanupExpiredContexts(): number {
    const result = getDb().prepare(`
        DELETE FROM agent_contexts WHERE expires_at IS NOT NULL AND datetime(expires_at) < datetime('now')
    `).run();
    return result.changes;
}

// Agent Handoff queries
export function insertAgentHandoff(handoff: Omit<AgentHandoff, 'created_at' | 'updated_at'>): void {
    getDb().prepare(`
        INSERT INTO agent_handoffs (id, project_id, run_id, from_agent, to_agent, handoff_type, status, payload, result, priority, accepted_at, completed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        handoff.id,
        handoff.project_id,
        handoff.run_id,
        handoff.from_agent,
        handoff.to_agent,
        handoff.handoff_type,
        handoff.status,
        handoff.payload,
        handoff.result,
        handoff.priority,
        handoff.accepted_at,
        handoff.completed_at
    );
}

export function getAgentHandoffById(id: string): AgentHandoff | undefined {
    return getDb().prepare('SELECT * FROM agent_handoffs WHERE id = ?').get(id) as AgentHandoff | undefined;
}

export function getPendingHandoffsForAgent(toAgent: string): AgentHandoff[] {
    return getDb().prepare(`
        SELECT * FROM agent_handoffs
        WHERE to_agent = ? AND status = 'pending'
        ORDER BY priority DESC, created_at ASC
    `).all(toAgent) as AgentHandoff[];
}

export function getHandoffsByProject(projectId: string): AgentHandoff[] {
    return getDb().prepare(`
        SELECT * FROM agent_handoffs WHERE project_id = ? ORDER BY created_at DESC
    `).all(projectId) as AgentHandoff[];
}

export function getHandoffsByRun(runId: string): AgentHandoff[] {
    return getDb().prepare(`
        SELECT * FROM agent_handoffs WHERE run_id = ? ORDER BY created_at DESC
    `).all(runId) as AgentHandoff[];
}

export function updateAgentHandoff(id: string, updates: Partial<Pick<AgentHandoff, 'status' | 'result' | 'accepted_at' | 'completed_at'>>): void {
    const setClauses: string[] = ['updated_at = datetime(\'now\')'];
    const values: (string | null)[] = [];

    if (updates.status !== undefined) {
        setClauses.push('status = ?');
        values.push(updates.status);
    }
    if (updates.result !== undefined) {
        setClauses.push('result = ?');
        values.push(updates.result);
    }
    if (updates.accepted_at !== undefined) {
        setClauses.push('accepted_at = ?');
        values.push(updates.accepted_at);
    }
    if (updates.completed_at !== undefined) {
        setClauses.push('completed_at = ?');
        values.push(updates.completed_at);
    }

    values.push(id);
    getDb().prepare(`UPDATE agent_handoffs SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
}

// Agent Validation queries
export function insertAgentValidation(validation: Omit<AgentValidation, 'created_at'>): void {
    getDb().prepare(`
        INSERT INTO agent_validations (id, project_id, run_id, prd_id, validation_type, validator_agent, target_agent, target_artifact, status, verdict, findings, severity, completed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        validation.id,
        validation.project_id,
        validation.run_id,
        validation.prd_id,
        validation.validation_type,
        validation.validator_agent,
        validation.target_agent,
        validation.target_artifact,
        validation.status,
        validation.verdict,
        validation.findings,
        validation.severity,
        validation.completed_at
    );
}

export function getAgentValidationById(id: string): AgentValidation | undefined {
    return getDb().prepare('SELECT * FROM agent_validations WHERE id = ?').get(id) as AgentValidation | undefined;
}

export function getValidationsByPrd(prdId: string): AgentValidation[] {
    return getDb().prepare(`
        SELECT * FROM agent_validations WHERE prd_id = ? ORDER BY created_at DESC
    `).all(prdId) as AgentValidation[];
}

export function getValidationsByRun(runId: string): AgentValidation[] {
    return getDb().prepare(`
        SELECT * FROM agent_validations WHERE run_id = ? ORDER BY created_at DESC
    `).all(runId) as AgentValidation[];
}

export function getPendingValidations(validatorAgent?: string): AgentValidation[] {
    if (validatorAgent) {
        return getDb().prepare(`
            SELECT * FROM agent_validations
            WHERE validator_agent = ? AND status IN ('pending', 'in_progress')
            ORDER BY created_at ASC
        `).all(validatorAgent) as AgentValidation[];
    }
    return getDb().prepare(`
        SELECT * FROM agent_validations WHERE status IN ('pending', 'in_progress') ORDER BY created_at ASC
    `).all() as AgentValidation[];
}

export function updateAgentValidation(id: string, updates: Partial<Pick<AgentValidation, 'status' | 'verdict' | 'findings' | 'severity' | 'completed_at'>>): void {
    const setClauses: string[] = [];
    const values: (string | null)[] = [];

    if (updates.status !== undefined) {
        setClauses.push('status = ?');
        values.push(updates.status);
    }
    if (updates.verdict !== undefined) {
        setClauses.push('verdict = ?');
        values.push(updates.verdict);
    }
    if (updates.findings !== undefined) {
        setClauses.push('findings = ?');
        values.push(updates.findings);
    }
    if (updates.severity !== undefined) {
        setClauses.push('severity = ?');
        values.push(updates.severity);
    }
    if (updates.completed_at !== undefined) {
        setClauses.push('completed_at = ?');
        values.push(updates.completed_at);
    }

    if (setClauses.length > 0) {
        values.push(id);
        getDb().prepare(`UPDATE agent_validations SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
    }
}

export function getValidationSummary(prdId: string): { passed: number; failed: number; pending: number; needsRevision: number } {
    const result = getDb().prepare(`
        SELECT
            SUM(CASE WHEN status = 'passed' THEN 1 ELSE 0 END) as passed,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
            SUM(CASE WHEN status IN ('pending', 'in_progress') THEN 1 ELSE 0 END) as pending,
            SUM(CASE WHEN status = 'needs_revision' THEN 1 ELSE 0 END) as needsRevision
        FROM agent_validations WHERE prd_id = ?
    `).get(prdId) as { passed: number; failed: number; pending: number; needsRevision: number };
    return {
        passed: result.passed || 0,
        failed: result.failed || 0,
        pending: result.pending || 0,
        needsRevision: result.needsRevision || 0
    };
}
