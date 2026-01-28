/**
 * Shared Context Store for Agent Collaboration
 *
 * Enables agents to share context and intermediate results across tasks.
 * Context can be scoped to a project (permanent) or a run (temporary).
 */

import {
    generateId,
    setAgentContext,
    getAgentContext,
    getAgentContextsByType,
    getAgentContextsByAgent,
    getAllAgentContexts,
    deleteAgentContext,
    cleanupExpiredContexts,
    type AgentContext,
} from '../db/index.js';

export type ContextType = 'general' | 'handoff' | 'validation' | 'artifact';

export interface ContextEntry<T = unknown> {
    key: string;
    value: T;
    agentName: string;
    type: ContextType;
    expiresAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

export interface ContextStoreOptions {
    projectId: string;
    runId?: string;
    agentName: string;
}

/**
 * High-level API for agents to share context
 */
export class ContextStore {
    private projectId: string;
    private runId?: string;
    private agentName: string;

    constructor(options: ContextStoreOptions) {
        this.projectId = options.projectId;
        this.runId = options.runId;
        this.agentName = options.agentName;
    }

    /**
     * Set a context value
     */
    set<T>(key: string, value: T, options?: { type?: ContextType; ttlMinutes?: number }): void {
        const expiresAt = options?.ttlMinutes
            ? new Date(Date.now() + options.ttlMinutes * 60 * 1000).toISOString()
            : null;

        setAgentContext({
            id: generateId(),
            project_id: this.projectId,
            run_id: this.runId ?? null,
            agent_name: this.agentName,
            context_key: key,
            context_value: JSON.stringify(value),
            context_type: options?.type ?? 'general',
            expires_at: expiresAt,
        });
    }

    /**
     * Get a context value
     */
    get<T>(key: string): T | undefined {
        const context = getAgentContext(this.projectId, key, this.runId);
        if (!context) return undefined;
        try {
            return JSON.parse(context.context_value) as T;
        } catch {
            return undefined;
        }
    }

    /**
     * Check if a context key exists
     */
    has(key: string): boolean {
        return getAgentContext(this.projectId, key, this.runId) !== undefined;
    }

    /**
     * Delete a context key
     */
    delete(key: string): void {
        deleteAgentContext(this.projectId, key, this.runId);
    }

    /**
     * Get all context entries
     */
    getAll(): ContextEntry[] {
        const contexts = getAllAgentContexts(this.projectId, this.runId);
        return contexts.map(this.toContextEntry);
    }

    /**
     * Get context entries by type
     */
    getByType(type: ContextType): ContextEntry[] {
        const contexts = getAgentContextsByType(this.projectId, type, this.runId);
        return contexts.map(this.toContextEntry);
    }

    /**
     * Get context entries created by a specific agent
     */
    getByAgent(agentName: string): ContextEntry[] {
        const contexts = getAgentContextsByAgent(this.projectId, agentName);
        return contexts.map(this.toContextEntry);
    }

    /**
     * Store an artifact (file content, analysis result, etc.)
     */
    storeArtifact<T>(key: string, value: T, ttlMinutes?: number): void {
        this.set(key, value, { type: 'artifact', ttlMinutes });
    }

    /**
     * Get an artifact
     */
    getArtifact<T>(key: string): T | undefined {
        return this.get<T>(key);
    }

    /**
     * Store handoff data for another agent
     */
    setHandoffData<T>(toAgent: string, data: T): void {
        const key = `handoff:${this.agentName}:${toAgent}`;
        this.set(key, data, { type: 'handoff' });
    }

    /**
     * Get handoff data from another agent
     */
    getHandoffData<T>(fromAgent: string): T | undefined {
        const key = `handoff:${fromAgent}:${this.agentName}`;
        return this.get<T>(key);
    }

    /**
     * Store validation context
     */
    setValidationContext<T>(validationId: string, data: T): void {
        const key = `validation:${validationId}`;
        this.set(key, data, { type: 'validation' });
    }

    /**
     * Get validation context
     */
    getValidationContext<T>(validationId: string): T | undefined {
        const key = `validation:${validationId}`;
        return this.get<T>(key);
    }

    /**
     * Clear all context for the current scope
     */
    clear(): void {
        const contexts = getAllAgentContexts(this.projectId, this.runId);
        for (const ctx of contexts) {
            if (this.runId) {
                // Only delete run-scoped contexts
                if (ctx.run_id === this.runId) {
                    deleteAgentContext(this.projectId, ctx.context_key, this.runId);
                }
            } else {
                // Delete project-level contexts (careful!)
                if (!ctx.run_id) {
                    deleteAgentContext(this.projectId, ctx.context_key);
                }
            }
        }
    }

    /**
     * Cleanup expired contexts (global operation)
     */
    static cleanup(): number {
        return cleanupExpiredContexts();
    }

    /**
     * Create a context store for a different run (useful for cross-run lookups)
     */
    forRun(runId: string): ContextStore {
        return new ContextStore({
            projectId: this.projectId,
            runId,
            agentName: this.agentName,
        });
    }

    /**
     * Create a project-level context store (no run scope)
     */
    forProject(): ContextStore {
        return new ContextStore({
            projectId: this.projectId,
            agentName: this.agentName,
        });
    }

    private toContextEntry(ctx: AgentContext): ContextEntry {
        let value: unknown;
        try {
            value = JSON.parse(ctx.context_value);
        } catch {
            value = ctx.context_value;
        }

        return {
            key: ctx.context_key,
            value,
            agentName: ctx.agent_name,
            type: ctx.context_type,
            expiresAt: ctx.expires_at ? new Date(ctx.expires_at) : undefined,
            createdAt: new Date(ctx.created_at),
            updatedAt: new Date(ctx.updated_at),
        };
    }
}

/**
 * Create a context store for an agent
 */
export function createContextStore(options: ContextStoreOptions): ContextStore {
    return new ContextStore(options);
}
