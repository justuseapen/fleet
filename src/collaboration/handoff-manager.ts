/**
 * Agent Handoff Manager
 *
 * Implements structured handoff system between different agent types.
 * Supports sequential, parallel, and callback handoff patterns.
 */

import {
    generateId,
    insertAgentHandoff,
    getAgentHandoffById,
    getPendingHandoffsForAgent,
    getHandoffsByProject,
    getHandoffsByRun,
    updateAgentHandoff,
    insertWorkLog,
    type AgentHandoff,
} from '../db/index.js';

export type HandoffType = 'sequential' | 'parallel' | 'callback';
export type HandoffStatus = 'pending' | 'accepted' | 'completed' | 'failed' | 'rejected';

export interface HandoffPayload<T = unknown> {
    /** The data being handed off */
    data: T;
    /** Instructions for the target agent */
    instructions?: string;
    /** Expected output format */
    expectedOutput?: string;
    /** Deadline for the handoff (ISO string) */
    deadline?: string;
    /** Additional metadata */
    metadata?: Record<string, unknown>;
}

export interface HandoffResult<T = unknown> {
    /** Whether the handoff was successful */
    success: boolean;
    /** The result data from the target agent */
    data?: T;
    /** Error message if failed */
    error?: string;
    /** Execution time in milliseconds */
    durationMs?: number;
}

export interface CreateHandoffOptions {
    projectId: string;
    runId?: string;
    fromAgent: string;
    toAgent: string;
    type: HandoffType;
    payload: HandoffPayload;
    priority?: number;
}

export interface HandoffInfo {
    id: string;
    fromAgent: string;
    toAgent: string;
    type: HandoffType;
    status: HandoffStatus;
    payload: HandoffPayload;
    result?: HandoffResult;
    priority: number;
    createdAt: Date;
    acceptedAt?: Date;
    completedAt?: Date;
}

/**
 * Manages handoffs between agents
 */
export class HandoffManager {
    private projectId: string;
    private runId?: string;
    private agentName: string;

    constructor(projectId: string, agentName: string, runId?: string) {
        this.projectId = projectId;
        this.agentName = agentName;
        this.runId = runId;
    }

    /**
     * Create a handoff to another agent
     */
    createHandoff<T>(toAgent: string, payload: HandoffPayload<T>, options?: {
        type?: HandoffType;
        priority?: number;
    }): string {
        const id = generateId();
        const type = options?.type ?? 'sequential';
        const priority = options?.priority ?? 0;

        insertAgentHandoff({
            id,
            project_id: this.projectId,
            run_id: this.runId ?? null,
            from_agent: this.agentName,
            to_agent: toAgent,
            handoff_type: type,
            status: 'pending',
            payload: JSON.stringify(payload),
            result: null,
            priority,
            accepted_at: null,
            completed_at: null,
        });

        // Log the handoff creation
        insertWorkLog({
            id: generateId(),
            run_id: this.runId ?? null,
            project_id: this.projectId,
            event_type: 'started',
            summary: `Handoff created: ${this.agentName} → ${toAgent}`,
            details: JSON.stringify({
                handoff_id: id,
                type,
                priority,
                instructions: payload.instructions,
            }),
        });

        return id;
    }

    /**
     * Get pending handoffs for the current agent
     */
    getPendingHandoffs(): HandoffInfo[] {
        const handoffs = getPendingHandoffsForAgent(this.agentName);
        return handoffs.map(this.toHandoffInfo);
    }

    /**
     * Accept a handoff (mark as being processed)
     */
    acceptHandoff(handoffId: string): HandoffPayload | undefined {
        const handoff = getAgentHandoffById(handoffId);
        if (!handoff) return undefined;
        if (handoff.to_agent !== this.agentName) return undefined;
        if (handoff.status !== 'pending') return undefined;

        updateAgentHandoff(handoffId, {
            status: 'accepted',
            accepted_at: new Date().toISOString(),
        });

        try {
            return JSON.parse(handoff.payload) as HandoffPayload;
        } catch {
            return undefined;
        }
    }

    /**
     * Complete a handoff with a result
     */
    completeHandoff<T>(handoffId: string, result: HandoffResult<T>): void {
        const handoff = getAgentHandoffById(handoffId);
        if (!handoff) return;
        if (handoff.to_agent !== this.agentName) return;

        updateAgentHandoff(handoffId, {
            status: result.success ? 'completed' : 'failed',
            result: JSON.stringify(result),
            completed_at: new Date().toISOString(),
        });

        // Log the completion
        insertWorkLog({
            id: generateId(),
            run_id: handoff.run_id,
            project_id: handoff.project_id,
            event_type: result.success ? 'completed' : 'failed',
            summary: `Handoff ${result.success ? 'completed' : 'failed'}: ${handoff.from_agent} → ${this.agentName}`,
            details: JSON.stringify({
                handoff_id: handoffId,
                success: result.success,
                error: result.error,
                duration_ms: result.durationMs,
            }),
        });
    }

    /**
     * Reject a handoff
     */
    rejectHandoff(handoffId: string, reason: string): void {
        const handoff = getAgentHandoffById(handoffId);
        if (!handoff) return;
        if (handoff.to_agent !== this.agentName) return;

        updateAgentHandoff(handoffId, {
            status: 'rejected',
            result: JSON.stringify({ success: false, error: reason }),
            completed_at: new Date().toISOString(),
        });

        insertWorkLog({
            id: generateId(),
            run_id: handoff.run_id,
            project_id: handoff.project_id,
            event_type: 'rejected',
            summary: `Handoff rejected: ${handoff.from_agent} → ${this.agentName}`,
            details: JSON.stringify({ handoff_id: handoffId, reason }),
        });
    }

    /**
     * Get the result of a handoff created by this agent
     */
    getHandoffResult<T>(handoffId: string): HandoffResult<T> | undefined {
        const handoff = getAgentHandoffById(handoffId);
        if (!handoff) return undefined;
        if (handoff.from_agent !== this.agentName) return undefined;
        if (!handoff.result) return undefined;

        try {
            return JSON.parse(handoff.result) as HandoffResult<T>;
        } catch {
            return undefined;
        }
    }

    /**
     * Wait for a handoff to complete (polling-based)
     */
    async waitForHandoff<T>(
        handoffId: string,
        options?: { pollIntervalMs?: number; timeoutMs?: number }
    ): Promise<HandoffResult<T> | undefined> {
        const pollInterval = options?.pollIntervalMs ?? 1000;
        const timeout = options?.timeoutMs ?? 300000; // 5 minutes default
        const startTime = Date.now();

        while (Date.now() - startTime < timeout) {
            const handoff = getAgentHandoffById(handoffId);
            if (!handoff) return undefined;

            if (handoff.status === 'completed' || handoff.status === 'failed' || handoff.status === 'rejected') {
                if (handoff.result) {
                    try {
                        return JSON.parse(handoff.result) as HandoffResult<T>;
                    } catch {
                        return undefined;
                    }
                }
                return { success: false, error: 'No result data' };
            }

            await new Promise(resolve => setTimeout(resolve, pollInterval));
        }

        return { success: false, error: 'Handoff timed out' };
    }

    /**
     * Get all handoffs for the current project
     */
    getProjectHandoffs(): HandoffInfo[] {
        const handoffs = getHandoffsByProject(this.projectId);
        return handoffs.map(this.toHandoffInfo);
    }

    /**
     * Get all handoffs for the current run
     */
    getRunHandoffs(): HandoffInfo[] {
        if (!this.runId) return [];
        const handoffs = getHandoffsByRun(this.runId);
        return handoffs.map(this.toHandoffInfo);
    }

    /**
     * Check if there are pending handoffs for an agent
     */
    hasPendingHandoffs(agentName?: string): boolean {
        const handoffs = getPendingHandoffsForAgent(agentName ?? this.agentName);
        return handoffs.length > 0;
    }

    /**
     * Create a chain of sequential handoffs
     */
    createHandoffChain<T>(
        agents: string[],
        initialPayload: HandoffPayload<T>
    ): string[] {
        const handoffIds: string[] = [];

        // Create handoffs for the chain
        for (let i = 0; i < agents.length; i++) {
            const fromAgent = i === 0 ? this.agentName : agents[i - 1];
            const toAgent = agents[i];

            const payload: HandoffPayload = i === 0
                ? initialPayload
                : {
                    data: null, // Will be filled by previous agent
                    instructions: `Continue chain from ${fromAgent}`,
                    metadata: {
                        chain_position: i,
                        chain_length: agents.length,
                        previous_handoff: handoffIds[i - 1],
                    },
                };

            const id = generateId();
            insertAgentHandoff({
                id,
                project_id: this.projectId,
                run_id: this.runId ?? null,
                from_agent: fromAgent,
                to_agent: toAgent,
                handoff_type: 'sequential',
                status: i === 0 ? 'pending' : 'pending', // All start pending
                payload: JSON.stringify(payload),
                result: null,
                priority: agents.length - i, // Higher priority for earlier in chain
                accepted_at: null,
                completed_at: null,
            });

            handoffIds.push(id);
        }

        return handoffIds;
    }

    private toHandoffInfo(handoff: AgentHandoff): HandoffInfo {
        let payload: HandoffPayload = { data: null };
        let result: HandoffResult | undefined;

        try {
            payload = JSON.parse(handoff.payload);
        } catch {
            // Use default
        }

        if (handoff.result) {
            try {
                result = JSON.parse(handoff.result);
            } catch {
                // No result
            }
        }

        return {
            id: handoff.id,
            fromAgent: handoff.from_agent,
            toAgent: handoff.to_agent,
            type: handoff.handoff_type,
            status: handoff.status,
            payload,
            result,
            priority: handoff.priority,
            createdAt: new Date(handoff.created_at),
            acceptedAt: handoff.accepted_at ? new Date(handoff.accepted_at) : undefined,
            completedAt: handoff.completed_at ? new Date(handoff.completed_at) : undefined,
        };
    }
}

/**
 * Create a handoff manager for an agent
 */
export function createHandoffManager(
    projectId: string,
    agentName: string,
    runId?: string
): HandoffManager {
    return new HandoffManager(projectId, agentName, runId);
}

/**
 * Standard handoff patterns for common agent workflows
 */
export const HandoffPatterns = {
    /**
     * Planner → Developer handoff
     */
    plannerToDeveloper(manager: HandoffManager, prdData: {
        prdId: string;
        prdContent: string;
        branch: string;
        iterations: number;
    }): string {
        return manager.createHandoff('developer', {
            data: prdData,
            instructions: 'Execute the PRD using Ralph autonomous loop',
            expectedOutput: 'Branch with completed implementation and optional PR URL',
        });
    },

    /**
     * Developer → QA handoff
     */
    developerToQa(manager: HandoffManager, prData: {
        prUrl: string;
        branch: string;
        prdId: string;
    }): string {
        return manager.createHandoff('qa', {
            data: prData,
            instructions: 'Review the pull request and provide feedback',
            expectedOutput: 'Review verdict (APPROVE, REQUEST_CHANGES, COMMENT) with issues',
        });
    },

    /**
     * QA → Developer callback (for revisions)
     */
    qaRevisionCallback(manager: HandoffManager, revisionData: {
        prUrl: string;
        issues: Array<{ file: string; line?: number; message: string; severity: string }>;
        suggestions: string[];
    }): string {
        return manager.createHandoff('developer', {
            data: revisionData,
            instructions: 'Address the QA feedback and update the PR',
            expectedOutput: 'Updated PR with addressed issues',
        }, { type: 'callback' });
    },

    /**
     * Strategic audit chain
     */
    strategicAuditChain(manager: HandoffManager, auditRequest: {
        projectId: string;
        scope: 'project' | 'cross-project';
    }): string[] {
        return manager.createHandoffChain(['strategic', 'visionary'], {
            data: auditRequest,
            instructions: 'Perform strategic audit and generate improvement proposals',
        });
    },
};
