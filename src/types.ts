// Unified task type across all adapters
export interface UnifiedTask {
    externalId: string;
    externalUrl: string | null;
    title: string;
    description: string | null;
    taskType: 'bug' | 'feature' | 'chore' | 'refactor';
    priority: 'low' | 'medium' | 'high' | 'critical' | null;
    labels: string[];
    assignee: string | null;
}

// Task source configurations
export interface JiraConfig {
    type: 'jira';
    project: string; // Jira project key
    jql?: string; // Optional custom JQL filter
}

export interface GitHubConfig {
    type: 'github';
    owner: string;
    repo: string;
    labels?: string[]; // Filter by labels
}

export interface LinearConfig {
    type: 'linear';
    teamId: string;
    projectId?: string;
}

export type TaskSourceConfig = JiraConfig | GitHubConfig | LinearConfig;

// Agent configuration
export interface AgentConfig {
    planner: boolean;
    developer: boolean;
    qa: boolean;
    strategic: boolean;
}

// Approval configuration
export interface ApprovalConfig {
    autoApproveThreshold: number; // Risk score below this = auto-approve
    requireApprovalTypes: ('bug' | 'feature' | 'chore' | 'refactor')[];
}

// Execution configuration
export interface ExecutionConfig {
    maxConcurrentAgents: number;
    defaultIterations: number;
    tool: 'claude' | 'cursor';
    branchPrefix: string;
}

// Full project configuration (as stored in fleet.json per project)
export interface FleetProjectConfig {
    projectId: string;
    name: string;
    taskSource: TaskSourceConfig;
    mission?: string;
    agents: AgentConfig;
    approval: ApprovalConfig;
    execution: ExecutionConfig;
}

// Default configurations
export const defaultAgentConfig: AgentConfig = {
    planner: true,
    developer: true,
    qa: true,
    strategic: true,
};

export const defaultApprovalConfig: ApprovalConfig = {
    autoApproveThreshold: 30,
    requireApprovalTypes: ['feature', 'refactor'],
};

export const defaultExecutionConfig: ExecutionConfig = {
    maxConcurrentAgents: 2,
    defaultIterations: 10,
    tool: 'claude',
    branchPrefix: 'fleet/',
};

// PRD JSON structure (Ralph format)
export interface UserStory {
    id: string;
    title: string;
    description: string;
    acceptanceCriteria: string[];
    priority: number;
    passes: boolean;
    notes: string;
}

export interface PrdJson {
    project: string;
    branchName: string;
    description: string;
    userStories: UserStory[];
}

// Risk factors
export interface RiskFactors {
    storyCount: number;
    estimatedFiles: number;
    hasMigrations: boolean;
    hasApiChanges: boolean;
    taskType: 'bug' | 'feature' | 'chore' | 'refactor';
}

// Global Fleet configuration (~/.fleet/config.json)
export interface FleetGlobalConfig {
    maxGlobalConcurrency: number;
    defaultTool: 'claude' | 'cursor';
    anthropicApiKey?: string;
    linearApiKey?: string;
}

export const defaultGlobalConfig: FleetGlobalConfig = {
    maxGlobalConcurrency: 4,
    defaultTool: 'claude',
};
