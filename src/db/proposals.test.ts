import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('proposals database schema', () => {
    let db: Database.Database;

    beforeEach(() => {
        // Create in-memory database for testing
        db = new Database(':memory:');
        const schemaPath = join(__dirname, 'schema.sql');
        const schema = readFileSync(schemaPath, 'utf-8');
        db.exec(schema);
    });

    afterEach(() => {
        db.close();
    });

    describe('proposals table', () => {
        it('should allow inserting a proposal', () => {
            // First insert a project
            db.prepare(`
                INSERT INTO projects (id, path, name, mission, task_source_type, task_source_config)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run('proj-1', '/test/path', 'Test Project', 'Test mission', 'github', '{}');

            // Insert proposal
            const result = db.prepare(`
                INSERT INTO proposals (id, project_id, title, rationale, status)
                VALUES (?, ?, ?, ?, ?)
            `).run('prop-1', 'proj-1', 'Test Proposal', 'Test rationale', 'proposed');

            expect(result.changes).toBe(1);
        });

        it('should have correct default status', () => {
            db.prepare(`
                INSERT INTO projects (id, path, name, task_source_type, task_source_config)
                VALUES (?, ?, ?, ?, ?)
            `).run('proj-1', '/test/path', 'Test', 'github', '{}');

            db.prepare(`
                INSERT INTO proposals (id, project_id, title, rationale)
                VALUES (?, ?, ?, ?)
            `).run('prop-1', 'proj-1', 'Test', 'Rationale');

            const proposal = db.prepare('SELECT * FROM proposals WHERE id = ?').get('prop-1') as { status: string };
            expect(proposal.status).toBe('proposed');
        });

        it('should allow all valid status values', () => {
            db.prepare(`
                INSERT INTO projects (id, path, name, task_source_type, task_source_config)
                VALUES (?, ?, ?, ?, ?)
            `).run('proj-1', '/test/path', 'Test', 'github', '{}');

            const statuses = ['proposed', 'approved', 'rejected', 'converted'];

            statuses.forEach((status, i) => {
                const result = db.prepare(`
                    INSERT INTO proposals (id, project_id, title, rationale, status)
                    VALUES (?, ?, ?, ?, ?)
                `).run(`prop-${i}`, 'proj-1', `Test ${i}`, 'Rationale', status);
                expect(result.changes).toBe(1);
            });
        });
    });

    describe('prds table with nullable task_id', () => {
        beforeEach(() => {
            // Set up project and proposal
            db.prepare(`
                INSERT INTO projects (id, path, name, task_source_type, task_source_config)
                VALUES (?, ?, ?, ?, ?)
            `).run('proj-1', '/test/path', 'Test', 'github', '{}');

            db.prepare(`
                INSERT INTO proposals (id, project_id, title, rationale, status)
                VALUES (?, ?, ?, ?, ?)
            `).run('prop-1', 'proj-1', 'Test Proposal', 'Rationale', 'proposed');
        });

        it('should allow PRD with task_id (task-based)', () => {
            // Insert a task first
            db.prepare(`
                INSERT INTO tasks (id, project_id, external_id, title, task_type, status)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run('task-1', 'proj-1', 'EXT-1', 'Test Task', 'feature', 'backlog');

            const result = db.prepare(`
                INSERT INTO prds (id, task_id, proposal_id, project_id, content, prd_json, risk_score, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run('prd-1', 'task-1', null, 'proj-1', 'PRD content', '{}', 50, 'pending');

            expect(result.changes).toBe(1);
        });

        it('should allow PRD with NULL task_id (proposal-based)', () => {
            // This is the critical test that would have caught our bug
            const result = db.prepare(`
                INSERT INTO prds (id, task_id, proposal_id, project_id, content, prd_json, risk_score, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run('prd-1', null, 'prop-1', 'proj-1', 'PRD content', '{}', 50, 'pending');

            expect(result.changes).toBe(1);

            const prd = db.prepare('SELECT * FROM prds WHERE id = ?').get('prd-1') as { task_id: string | null };
            expect(prd.task_id).toBeNull();
        });

        it('should allow PRD with both task_id and proposal_id as NULL', () => {
            // Edge case: orphan PRD (shouldn't happen in practice but schema allows it)
            const result = db.prepare(`
                INSERT INTO prds (id, task_id, proposal_id, project_id, content, prd_json, risk_score, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run('prd-1', null, null, 'proj-1', 'PRD content', '{}', 50, 'pending');

            expect(result.changes).toBe(1);
        });
    });

    describe('proposal indexes', () => {
        it('should have index on project_id', () => {
            const indexes = db.prepare(`
                SELECT name FROM sqlite_master
                WHERE type = 'index' AND tbl_name = 'proposals'
            `).all() as { name: string }[];

            const indexNames = indexes.map(i => i.name);
            expect(indexNames).toContain('idx_proposals_project');
        });

        it('should have index on status', () => {
            const indexes = db.prepare(`
                SELECT name FROM sqlite_master
                WHERE type = 'index' AND tbl_name = 'proposals'
            `).all() as { name: string }[];

            const indexNames = indexes.map(i => i.name);
            expect(indexNames).toContain('idx_proposals_status');
        });

        it('should have index on prds.proposal_id', () => {
            const indexes = db.prepare(`
                SELECT name FROM sqlite_master
                WHERE type = 'index' AND tbl_name = 'prds'
            `).all() as { name: string }[];

            const indexNames = indexes.map(i => i.name);
            expect(indexNames).toContain('idx_prds_proposal');
        });
    });
});
