import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the db module
vi.mock('../db/index.js', () => ({
    getTasksByProject: vi.fn(),
    getAllProjects: vi.fn(),
}));

import { getTasksByProject, getAllProjects } from '../db/index.js';
import {
    getBacklogHealth,
    isBacklogLow,
    getAllBacklogHealth,
    getProjectsNeedingIdeas,
} from './backlog-analyzer.js';

const mockGetTasksByProject = vi.mocked(getTasksByProject);
const mockGetAllProjects = vi.mocked(getAllProjects);

describe('backlog-analyzer', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // Default mock for getAllProjects
        mockGetAllProjects.mockReturnValue([
            {
                id: 'proj-1',
                name: 'Test Project',
                path: '/test',
                mission: 'Test mission',
                task_source_type: 'github',
                task_source_config: '{}',
                agent_config: '{}',
                approval_config: '{}',
                execution_config: '{}',
                created_at: '2024-01-01',
                updated_at: '2024-01-01',
            },
        ]);
    });

    describe('getBacklogHealth', () => {
        it('should return empty status when no tasks', () => {
            mockGetTasksByProject.mockReturnValue([]);

            const health = getBacklogHealth('proj-1');

            expect(health.isEmpty).toBe(true);
            expect(health.isLow).toBe(false);
            expect(health.count).toBe(0);
        });

        it('should return isLow when backlog at or below threshold', () => {
            mockGetTasksByProject.mockReturnValue([
                createMockTask('task-1', 'backlog'),
                createMockTask('task-2', 'backlog'),
            ]);

            const health = getBacklogHealth('proj-1', 3);

            expect(health.isEmpty).toBe(false);
            expect(health.isLow).toBe(true);
            expect(health.count).toBe(2);
        });

        it('should not return isLow when backlog above threshold', () => {
            mockGetTasksByProject.mockReturnValue([
                createMockTask('task-1', 'backlog'),
                createMockTask('task-2', 'backlog'),
                createMockTask('task-3', 'backlog'),
                createMockTask('task-4', 'backlog'),
            ]);

            const health = getBacklogHealth('proj-1', 3);

            expect(health.isEmpty).toBe(false);
            expect(health.isLow).toBe(false);
            expect(health.count).toBe(4);
        });

        it('should only count backlog tasks, not completed ones', () => {
            mockGetTasksByProject.mockReturnValue([
                createMockTask('task-1', 'backlog'),
                createMockTask('task-2', 'completed'),
                createMockTask('task-3', 'running'),
                createMockTask('task-4', 'backlog'),
            ]);

            const health = getBacklogHealth('proj-1', 3);

            expect(health.count).toBe(2);
        });

        it('should count high priority tasks', () => {
            mockGetTasksByProject.mockReturnValue([
                createMockTask('task-1', 'backlog', 'high'),
                createMockTask('task-2', 'backlog', 'critical'),
                createMockTask('task-3', 'backlog', 'low'),
                createMockTask('task-4', 'backlog', 'medium'),
            ]);

            const health = getBacklogHealth('proj-1');

            expect(health.highPriorityCount).toBe(2);
        });

        it('should categorize tasks by type', () => {
            mockGetTasksByProject.mockReturnValue([
                createMockTask('task-1', 'backlog', 'medium', 'bug'),
                createMockTask('task-2', 'backlog', 'medium', 'bug'),
                createMockTask('task-3', 'backlog', 'medium', 'feature'),
                createMockTask('task-4', 'backlog', 'medium', 'chore'),
            ]);

            const health = getBacklogHealth('proj-1');

            expect(health.byType.bug).toBe(2);
            expect(health.byType.feature).toBe(1);
            expect(health.byType.chore).toBe(1);
            expect(health.byType.refactor).toBe(0);
        });
    });

    describe('isBacklogLow', () => {
        it('should return true for empty backlog', () => {
            mockGetTasksByProject.mockReturnValue([]);

            expect(isBacklogLow('proj-1')).toBe(true);
        });

        it('should return true at threshold', () => {
            mockGetTasksByProject.mockReturnValue([
                createMockTask('task-1', 'backlog'),
                createMockTask('task-2', 'backlog'),
                createMockTask('task-3', 'backlog'),
            ]);

            expect(isBacklogLow('proj-1', 3)).toBe(true);
        });

        it('should return false above threshold', () => {
            mockGetTasksByProject.mockReturnValue([
                createMockTask('task-1', 'backlog'),
                createMockTask('task-2', 'backlog'),
                createMockTask('task-3', 'backlog'),
                createMockTask('task-4', 'backlog'),
            ]);

            expect(isBacklogLow('proj-1', 3)).toBe(false);
        });
    });

    describe('getProjectsNeedingIdeas', () => {
        it('should return projects with low or empty backlogs', () => {
            mockGetAllProjects.mockReturnValue([
                createMockProject('proj-1', 'Empty Project'),
                createMockProject('proj-2', 'Low Project'),
                createMockProject('proj-3', 'Healthy Project'),
            ]);

            mockGetTasksByProject.mockImplementation((projectId: string) => {
                if (projectId === 'proj-1') return [];
                if (projectId === 'proj-2') return [
                    createMockTask('t1', 'backlog'),
                    createMockTask('t2', 'backlog'),
                ];
                return [
                    createMockTask('t1', 'backlog'),
                    createMockTask('t2', 'backlog'),
                    createMockTask('t3', 'backlog'),
                    createMockTask('t4', 'backlog'),
                    createMockTask('t5', 'backlog'),
                ];
            });

            const needingIdeas = getProjectsNeedingIdeas(3);

            expect(needingIdeas).toHaveLength(2);
            expect(needingIdeas.map(p => p.projectName)).toContain('Empty Project');
            expect(needingIdeas.map(p => p.projectName)).toContain('Low Project');
            expect(needingIdeas.map(p => p.projectName)).not.toContain('Healthy Project');
        });
    });
});

// Helper functions
function createMockTask(
    id: string,
    status: string,
    priority: string = 'medium',
    taskType: string = 'feature'
) {
    return {
        id,
        project_id: 'proj-1',
        external_id: `EXT-${id}`,
        external_url: null,
        title: `Task ${id}`,
        description: null,
        task_type: taskType as 'bug' | 'feature' | 'chore' | 'refactor',
        priority: priority as 'low' | 'medium' | 'high' | 'critical',
        status: status as 'backlog' | 'planning' | 'approved' | 'running' | 'completed' | 'failed',
        labels: null,
        assignee: null,
        synced_at: '2024-01-01',
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
    };
}

function createMockProject(id: string, name: string) {
    return {
        id,
        name,
        path: `/test/${id}`,
        mission: 'Test mission',
        task_source_type: 'github' as const,
        task_source_config: '{}',
        agent_config: '{}',
        approval_config: '{}',
        execution_config: '{}',
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
    };
}
