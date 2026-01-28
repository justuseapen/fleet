import type { Project, Task, Prd, Run } from '../db/index.js';
import { ContextStore, createContextStore } from '../collaboration/context-store.js';

/**
 * Base interface for all Fleet agents
 */
export interface Agent {
    name: string;
    description: string;

    /**
     * Execute the agent's task
     */
    execute(context: AgentContext): Promise<AgentResult>;
}

/**
 * Context provided to agents during execution
 */
export interface AgentContext {
    project: Project;
    task?: Task;
    prd?: Prd;
    run?: Run;
    workDir: string;
    /** Shared context store for agent collaboration */
    contextStore?: ContextStore;
}

/**
 * Result returned by agents
 */
export interface AgentResult {
    success: boolean;
    output?: string;
    error?: string;
    artifacts?: Record<string, unknown>;
}

/**
 * Create an agent context with collaboration features
 */
export function createAgentContext(
    baseContext: Omit<AgentContext, 'contextStore'>,
    agentName: string
): AgentContext {
    return {
        ...baseContext,
        contextStore: createContextStore({
            projectId: baseContext.project.id,
            runId: baseContext.run?.id,
            agentName,
        }),
    };
}
