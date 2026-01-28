-- Fleet Database Schema

-- Projects registered with Fleet
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    mission TEXT,
    task_source_type TEXT NOT NULL, -- 'jira', 'github', 'linear'
    task_source_config TEXT NOT NULL, -- JSON config
    agent_config TEXT NOT NULL DEFAULT '{}', -- JSON agent settings
    approval_config TEXT NOT NULL DEFAULT '{}', -- JSON approval settings
    execution_config TEXT NOT NULL DEFAULT '{}', -- JSON execution settings
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Synced tasks from external sources
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    external_id TEXT NOT NULL, -- Jira key, GitHub issue number, Linear ID
    external_url TEXT,
    title TEXT NOT NULL,
    description TEXT,
    task_type TEXT NOT NULL, -- 'bug', 'feature', 'chore', 'refactor'
    priority TEXT, -- 'low', 'medium', 'high', 'critical'
    status TEXT NOT NULL DEFAULT 'backlog', -- 'backlog', 'planning', 'approved', 'running', 'completed', 'failed'
    labels TEXT, -- JSON array
    assignee TEXT,
    synced_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(project_id, external_id)
);

-- Generated PRDs awaiting approval
CREATE TABLE IF NOT EXISTS prds (
    id TEXT PRIMARY KEY,
    task_id TEXT REFERENCES tasks(id), -- NULL for proactive proposals
    proposal_id TEXT REFERENCES proposals(id), -- NULL for task-based PRDs
    project_id TEXT NOT NULL REFERENCES projects(id),
    content TEXT NOT NULL, -- Full PRD markdown
    prd_json TEXT NOT NULL, -- prd.json content
    risk_score INTEGER NOT NULL DEFAULT 50,
    risk_factors TEXT, -- JSON breakdown
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'approved', 'rejected', 'executed'
    approved_at TEXT,
    approved_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Execution runs (Ralph sessions)
CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    prd_id TEXT NOT NULL REFERENCES prds(id),
    project_id TEXT NOT NULL REFERENCES projects(id),
    branch TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'running', 'completed', 'failed'
    iterations_planned INTEGER NOT NULL DEFAULT 10,
    iterations_completed INTEGER NOT NULL DEFAULT 0,
    started_at TEXT,
    completed_at TEXT,
    error TEXT,
    pr_url TEXT,
    worktree_path TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Work log for briefings
CREATE TABLE IF NOT EXISTS work_log (
    id TEXT PRIMARY KEY,
    run_id TEXT REFERENCES runs(id),
    project_id TEXT NOT NULL REFERENCES projects(id),
    event_type TEXT NOT NULL, -- 'started', 'completed', 'failed', 'pr_created', 'approved', 'rejected'
    summary TEXT NOT NULL,
    details TEXT, -- JSON additional info
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Strategic audit reports
CREATE TABLE IF NOT EXISTS audits (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id), -- NULL for cross-project audits
    report TEXT NOT NULL, -- Markdown report
    recommendations TEXT, -- JSON array
    scope_creep_detected INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Proactive feature proposals from VisionaryAgent
CREATE TABLE IF NOT EXISTS proposals (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    title TEXT NOT NULL,
    rationale TEXT,
    source_context TEXT, -- JSON context that led to proposal
    status TEXT NOT NULL DEFAULT 'proposed', -- 'proposed', 'approved', 'rejected', 'converted'
    converted_task_id TEXT REFERENCES tasks(id), -- If converted to a task
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Codebase analysis cache
CREATE TABLE IF NOT EXISTS codebase_analysis (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    analysis_data TEXT NOT NULL, -- JSON CodebaseAnalysis
    analyzed_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    UNIQUE(project_id)
);

-- Shared context store for agent collaboration
CREATE TABLE IF NOT EXISTS agent_contexts (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    run_id TEXT REFERENCES runs(id), -- NULL for project-level context
    agent_name TEXT NOT NULL, -- Which agent created this context
    context_key TEXT NOT NULL, -- Lookup key (e.g., 'analysis_result', 'validation_status')
    context_value TEXT NOT NULL, -- JSON data
    context_type TEXT NOT NULL DEFAULT 'general', -- 'general', 'handoff', 'validation', 'artifact'
    expires_at TEXT, -- NULL for permanent, datetime for expiring
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(project_id, run_id, context_key) -- One entry per key per scope
);

-- Agent handoffs for structured inter-agent communication
CREATE TABLE IF NOT EXISTS agent_handoffs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    run_id TEXT REFERENCES runs(id),
    from_agent TEXT NOT NULL, -- Agent handing off
    to_agent TEXT NOT NULL, -- Target agent
    handoff_type TEXT NOT NULL, -- 'sequential', 'parallel', 'callback'
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'accepted', 'completed', 'failed', 'rejected'
    payload TEXT NOT NULL, -- JSON handoff data
    result TEXT, -- JSON result from target agent
    priority INTEGER NOT NULL DEFAULT 0, -- Higher = more urgent
    accepted_at TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Cross-agent validation records
CREATE TABLE IF NOT EXISTS agent_validations (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    run_id TEXT REFERENCES runs(id),
    prd_id TEXT REFERENCES prds(id),
    validation_type TEXT NOT NULL, -- 'code_review', 'risk_assessment', 'quality_check', 'security_scan'
    validator_agent TEXT NOT NULL, -- Agent performing validation
    target_agent TEXT, -- Agent whose work is being validated (NULL for artifacts)
    target_artifact TEXT, -- What's being validated (e.g., 'prd', 'code', 'pr')
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'in_progress', 'passed', 'failed', 'needs_revision'
    verdict TEXT, -- 'approve', 'reject', 'request_changes'
    findings TEXT, -- JSON array of issues/observations
    severity TEXT, -- 'info', 'warning', 'error', 'critical'
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_prds_status ON prds(status);
CREATE INDEX IF NOT EXISTS idx_prds_proposal ON prds(proposal_id);
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
CREATE INDEX IF NOT EXISTS idx_work_log_created ON work_log(created_at);
CREATE INDEX IF NOT EXISTS idx_codebase_analysis_project ON codebase_analysis(project_id);
CREATE INDEX IF NOT EXISTS idx_proposals_project ON proposals(project_id);
CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);

-- Indexes for agent collaboration tables
CREATE INDEX IF NOT EXISTS idx_agent_contexts_project ON agent_contexts(project_id);
CREATE INDEX IF NOT EXISTS idx_agent_contexts_run ON agent_contexts(run_id);
CREATE INDEX IF NOT EXISTS idx_agent_contexts_key ON agent_contexts(context_key);
CREATE INDEX IF NOT EXISTS idx_agent_contexts_type ON agent_contexts(context_type);
CREATE INDEX IF NOT EXISTS idx_agent_handoffs_project ON agent_handoffs(project_id);
CREATE INDEX IF NOT EXISTS idx_agent_handoffs_status ON agent_handoffs(status);
CREATE INDEX IF NOT EXISTS idx_agent_handoffs_to ON agent_handoffs(to_agent, status);
CREATE INDEX IF NOT EXISTS idx_agent_validations_project ON agent_validations(project_id);
CREATE INDEX IF NOT EXISTS idx_agent_validations_status ON agent_validations(status);
CREATE INDEX IF NOT EXISTS idx_agent_validations_prd ON agent_validations(prd_id);
