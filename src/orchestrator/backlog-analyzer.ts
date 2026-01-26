import { getTasksByProject, getAllProjects, type Task } from '../db/index.js';

export interface BacklogHealth {
    projectId: string;
    projectName: string;
    count: number;
    isEmpty: boolean;
    isLow: boolean;
    highPriorityCount: number;
    byType: {
        bug: number;
        feature: number;
        chore: number;
        refactor: number;
    };
}

/**
 * Get backlog health metrics for a specific project
 */
export function getBacklogHealth(projectId: string, threshold: number = 3): BacklogHealth {
    const tasks = getTasksByProject(projectId);
    const backlogTasks = tasks.filter(t => t.status === 'backlog');

    const project = getAllProjects().find(p => p.id === projectId);

    return {
        projectId,
        projectName: project?.name || 'Unknown',
        count: backlogTasks.length,
        isEmpty: backlogTasks.length === 0,
        isLow: backlogTasks.length > 0 && backlogTasks.length <= threshold,
        highPriorityCount: backlogTasks.filter(
            t => t.priority === 'high' || t.priority === 'critical'
        ).length,
        byType: {
            bug: backlogTasks.filter(t => t.task_type === 'bug').length,
            feature: backlogTasks.filter(t => t.task_type === 'feature').length,
            chore: backlogTasks.filter(t => t.task_type === 'chore').length,
            refactor: backlogTasks.filter(t => t.task_type === 'refactor').length,
        },
    };
}

/**
 * Check if a project's backlog is low (at or below threshold)
 */
export function isBacklogLow(projectId: string, threshold: number = 3): boolean {
    const health = getBacklogHealth(projectId, threshold);
    return health.isEmpty || health.isLow;
}

/**
 * Get backlog health for all registered projects
 */
export function getAllBacklogHealth(threshold: number = 3): BacklogHealth[] {
    const projects = getAllProjects();
    return projects.map(p => getBacklogHealth(p.id, threshold));
}

/**
 * Get projects with low or empty backlogs
 */
export function getProjectsNeedingIdeas(threshold: number = 3): BacklogHealth[] {
    return getAllBacklogHealth(threshold).filter(h => h.isEmpty || h.isLow);
}
