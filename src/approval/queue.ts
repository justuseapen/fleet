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
import { calculateQualityScore, type QualityScore } from './quality.js';
import { getCodebaseAnalyzer } from '../analysis/index.js';
import type { PrdJson, ApprovalConfig } from '../types.js';

export interface PendingApproval {
    prd: Prd;
    project: Project;
    task: Task | null; // Null for proposal-based PRDs
    riskBreakdown: Record<string, { score: number; description: string }>;
    approvalRequirement: 'auto-approve' | 'review' | 'require-approval';
    quality?: QualityScore; // Quality score for the PRD
}

/**
 * Get all pending approvals with enriched data
 * Note: This only returns task-based PRDs. For proposal-based PRDs, use getProposalsByStatus('proposed')
 */
export function getPendingApprovals(includeQuality = false): PendingApproval[] {
    const pendingPrds = getPrdsByStatus('pending');
    const approvals: PendingApproval[] = [];
    const analyzer = getCodebaseAnalyzer();

    for (const prd of pendingPrds) {
        // Skip proposal-based PRDs (no task_id)
        if (!prd.task_id) continue;

        const project = getProjectById(prd.project_id);
        const task = prd.task_id ? getTaskById(prd.task_id) ?? null : null;

        if (!project) continue;
        // Allow PRDs without tasks (proposal-based)
        if (prd.task_id && !task) continue;

        const approvalConfig: ApprovalConfig = JSON.parse(project.approval_config);
        const prdJson: PrdJson = JSON.parse(prd.prd_json);
        const taskType = task?.task_type || 'feature'; // Default to feature for proposals
        const riskFactors = extractRiskFactors(prd.content, prdJson, taskType);

        const approval: PendingApproval = {
            prd,
            project,
            task,
            riskBreakdown: getRiskBreakdown(riskFactors),
            approvalRequirement: determineApprovalRequirement(
                prd.risk_score,
                taskType,
                approvalConfig.autoApproveThreshold,
                approvalConfig.requireApprovalTypes
            ),
        };

        // Calculate quality score if requested
        if (includeQuality) {
            try {
                const codebaseAnalysis = analyzer.getFromCache(project.id);
                approval.quality = calculateQualityScore(prd.content, prdJson, codebaseAnalysis);
            } catch {
                // Skip quality if analysis fails
            }
        }

        approvals.push(approval);
    }

    // Sort by risk score descending
    return approvals.sort((a, b) => b.prd.risk_score - a.prd.risk_score);
}

/**
 * Get pending approvals sorted by quality score
 */
export function getPendingApprovalsByQuality(): PendingApproval[] {
    const approvals = getPendingApprovals(true);
    return approvals.sort((a, b) => {
        const qualityA = a.quality?.overall ?? 0;
        const qualityB = b.quality?.overall ?? 0;
        return qualityB - qualityA;
    });
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

    // Only update task status if there's a linked task (not proposal-based)
    if (prd.task_id) {
        updateTaskStatus(prd.task_id, 'approved');
    }

    const project = getProjectById(prd.project_id);
    insertWorkLog({
        id: generateId(),
        run_id: null,
        project_id: prd.project_id,
        event_type: 'approved',
        summary: `PRD approved for ${prd.task_id ? 'task' : 'proposal'} in ${project?.name || 'unknown project'}`,
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

    // Only update task status if there's a linked task (not proposal-based)
    if (prd.task_id) {
        updateTaskStatus(prd.task_id, 'backlog');
    }

    const project = getProjectById(prd.project_id);
    insertWorkLog({
        id: generateId(),
        run_id: null,
        project_id: prd.project_id,
        event_type: 'rejected',
        summary: `PRD rejected for ${prd.task_id ? 'task' : 'proposal'} in ${project?.name || 'unknown project'}`,
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

    // Determine task type from task or default to 'feature' for proposal-based PRDs
    const task = prd.task_id ? getTaskById(prd.task_id) : null;
    const taskType = task?.task_type || 'feature';

    const prdJson: PrdJson = JSON.parse(prd.prd_json);
    const factors = extractRiskFactors(prd.content, prdJson, taskType);

    return calculateRiskScore(factors);
}
