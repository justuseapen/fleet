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
    task_id TEXT NOT NULL REFERENCES tasks(id),
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

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_prds_status ON prds(status);
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
CREATE INDEX IF NOT EXISTS idx_work_log_created ON work_log(created_at);
