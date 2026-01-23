import type { Project, Task, Prd, Run } from '../db/index.js';

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
