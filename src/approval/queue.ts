import {
    getPrdsByStatus,
    updatePrdStatus,
    getProjectById,
    getTaskById,
    insertWorkLog,
    generateId,
    updateTaskStatus,
    type Prd,
    type Project,
    type Task,
} from '../db/index.js';
import {
    calculateRiskScore,
    extractRiskFactors,
    determineApprovalRequirement,
    getRiskBreakdown,
} from './risk.js';
import type { PrdJson, ApprovalConfig } from '../types.js';

export interface PendingApproval {
    prd: Prd;
    project: Project;
    task: Task;
    riskBreakdown: Record<string, { score: number; description: string }>;
    approvalRequirement: 'auto-approve' | 'review' | 'require-approval';
}

/**
 * Get all pending approvals with enriched data
 */
export function getPendingApprovals(): PendingApproval[] {
    const pendingPrds = getPrdsByStatus('pending');
    const approvals: PendingApproval[] = [];

    for (const prd of pendingPrds) {
        const project = getProjectById(prd.project_id);
        const task = getTaskById(prd.task_id);

        if (!project || !task) continue;

        const approvalConfig: ApprovalConfig = JSON.parse(project.approval_config);
        const prdJson: PrdJson = JSON.parse(prd.prd_json);
        const riskFactors = extractRiskFactors(prd.content, prdJson, task.task_type);

        approvals.push({
            prd,
            project,
            task,
            riskBreakdown: getRiskBreakdown(riskFactors),
            approvalRequirement: determineApprovalRequirement(
                prd.risk_score,
                task.task_type,
                approvalConfig.autoApproveThreshold,
                approvalConfig.requireApprovalTypes
            ),
        });
    }

    // Sort by risk score descending
    return approvals.sort((a, b) => b.prd.risk_score - a.prd.risk_score);
}

/**
 * Approve a PRD
 */
export function approvePrd(prdId: string, approvedBy: string): void {
    const prd = getPrdsByStatus('pending').find(p => p.id === prdId);
    if (!prd) {
        throw new Error(`PRD ${prdId} not found or not pending`);
    }

    updatePrdStatus(prdId, 'approved', approvedBy);
    updateTaskStatus(prd.task_id, 'approved');

    const project = getProjectById(prd.project_id);
    insertWorkLog({
        id: generateId(),
        run_id: null,
        project_id: prd.project_id,
        event_type: 'approved',
        summary: `PRD approved for task in ${project?.name || 'unknown project'}`,
        details: JSON.stringify({ prd_id: prdId, approved_by: approvedBy }),
    });
}

/**
 * Reject a PRD
 */
export function rejectPrd(prdId: string, reason?: string): void {
    const prd = getPrdsByStatus('pending').find(p => p.id === prdId);
    if (!prd) {
        throw new Error(`PRD ${prdId} not found or not pending`);
    }

    updatePrdStatus(prdId, 'rejected');
    updateTaskStatus(prd.task_id, 'backlog');

    const project = getProjectById(prd.project_id);
    insertWorkLog({
        id: generateId(),
        run_id: null,
        project_id: prd.project_id,
        event_type: 'rejected',
        summary: `PRD rejected for task in ${project?.name || 'unknown project'}`,
        details: JSON.stringify({ prd_id: prdId, reason }),
    });
}

/**
 * Process auto-approvals for low-risk PRDs
 */
export function processAutoApprovals(): { approved: string[]; skipped: string[] } {
    const pending = getPendingApprovals();
    const approved: string[] = [];
    const skipped: string[] = [];

    for (const item of pending) {
        if (item.approvalRequirement === 'auto-approve') {
            approvePrd(item.prd.id, 'fleet-auto');
            approved.push(item.prd.id);
        } else {
            skipped.push(item.prd.id);
        }
    }

    return { approved, skipped };
}

/**
 * Recalculate risk score for a PRD
 */
export function recalculateRiskScore(prdId: string): number {
    const prd = getPrdsByStatus('pending').find(p => p.id === prdId);
    if (!prd) {
        throw new Error(`PRD ${prdId} not found`);
    }

    const task = getTaskById(prd.task_id);
    if (!task) {
        throw new Error(`Task not found for PRD ${prdId}`);
    }

    const prdJson: PrdJson = JSON.parse(prd.prd_json);
    const factors = extractRiskFactors(prd.content, prdJson, task.task_type);

    return calculateRiskScore(factors);
}
