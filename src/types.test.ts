import { describe, it, expect } from 'vitest';
import {
    defaultAgentConfig,
    defaultApprovalConfig,
    defaultExecutionConfig,
    defaultGlobalConfig,
} from './types.js';

describe('default configurations', () => {
    it('should have valid default agent config', () => {
        expect(defaultAgentConfig.planner).toBe(true);
        expect(defaultAgentConfig.developer).toBe(true);
        expect(defaultAgentConfig.qa).toBe(true);
        expect(defaultAgentConfig.strategic).toBe(true);
    });

    it('should have valid default approval config', () => {
        expect(defaultApprovalConfig.autoApproveThreshold).toBe(30);
        expect(defaultApprovalConfig.requireApprovalTypes).toContain('feature');
        expect(defaultApprovalConfig.requireApprovalTypes).toContain('refactor');
    });

    it('should have valid default execution config', () => {
        expect(defaultExecutionConfig.maxConcurrentAgents).toBe(2);
        expect(defaultExecutionConfig.defaultIterations).toBe(10);
        expect(defaultExecutionConfig.tool).toBe('claude');
        expect(defaultExecutionConfig.branchPrefix).toBe('fleet/');
    });

    it('should have valid default global config', () => {
        expect(defaultGlobalConfig.maxGlobalConcurrency).toBe(4);
        expect(defaultGlobalConfig.defaultTool).toBe('claude');
    });
});
