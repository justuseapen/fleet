import { describe, it, expect } from 'vitest';
import {
    calculateRiskScore,
    extractRiskFactors,
    determineApprovalRequirement,
    getRiskBreakdown,
} from './risk.js';
import type { RiskFactors, PrdJson } from '../types.js';

describe('calculateRiskScore', () => {
    it('should return low score for simple bug fix', () => {
        const factors: RiskFactors = {
            storyCount: 1,
            estimatedFiles: 2,
            hasMigrations: false,
            hasApiChanges: false,
            taskType: 'bug',
        };

        const score = calculateRiskScore(factors);
        expect(score).toBeLessThan(30);
    });

    it('should return higher score for complex refactor', () => {
        const factors: RiskFactors = {
            storyCount: 8,
            estimatedFiles: 15,
            hasMigrations: true,
            hasApiChanges: true,
            taskType: 'refactor',
        };

        const score = calculateRiskScore(factors);
        // Complex refactor should have significant score
        expect(score).toBeGreaterThan(40);
    });

    it('should return moderate score for typical feature', () => {
        const factors: RiskFactors = {
            storyCount: 3,
            estimatedFiles: 5,
            hasMigrations: false,
            hasApiChanges: true,
            taskType: 'feature',
        };

        const score = calculateRiskScore(factors);
        // Typical feature should have moderate score
        expect(score).toBeGreaterThan(15);
        expect(score).toBeLessThanOrEqual(70);
    });
});

describe('extractRiskFactors', () => {
    const basePrdJson: PrdJson = {
        project: 'test',
        branchName: 'fleet/test',
        description: 'Test PRD',
        userStories: [
            {
                id: 'US-001',
                title: 'Test story',
                description: 'Test',
                acceptanceCriteria: ['Test'],
                priority: 1,
                passes: false,
                notes: '',
            },
        ],
    };

    it('should detect database migrations', () => {
        const content = 'This feature requires a database migration to add a new column.';
        const factors = extractRiskFactors(content, basePrdJson, 'feature');

        expect(factors.hasMigrations).toBe(true);
    });

    it('should detect API changes', () => {
        const content = 'We need to create a new API endpoint for user data.';
        const factors = extractRiskFactors(content, basePrdJson, 'feature');

        expect(factors.hasApiChanges).toBe(true);
    });

    it('should count user stories', () => {
        const prdJson: PrdJson = {
            ...basePrdJson,
            userStories: [
                { id: 'US-001', title: 'Story 1', description: '', acceptanceCriteria: [], priority: 1, passes: false, notes: '' },
                { id: 'US-002', title: 'Story 2', description: '', acceptanceCriteria: [], priority: 2, passes: false, notes: '' },
                { id: 'US-003', title: 'Story 3', description: '', acceptanceCriteria: [], priority: 3, passes: false, notes: '' },
            ],
        };

        const factors = extractRiskFactors('Simple content', prdJson, 'feature');

        expect(factors.storyCount).toBe(3);
    });
});

describe('determineApprovalRequirement', () => {
    it('should auto-approve low risk scores', () => {
        const result = determineApprovalRequirement(20, 'bug', 30, ['feature', 'refactor']);
        expect(result).toBe('auto-approve');
    });

    it('should require review for medium risk scores', () => {
        const result = determineApprovalRequirement(50, 'chore', 30, ['feature', 'refactor']);
        expect(result).toBe('review');
    });

    it('should require approval for high risk scores', () => {
        const result = determineApprovalRequirement(80, 'bug', 30, ['feature', 'refactor']);
        expect(result).toBe('require-approval');
    });

    it('should require review for features regardless of score', () => {
        const result = determineApprovalRequirement(25, 'feature', 30, ['feature', 'refactor']);
        expect(result).toBe('review');
    });
});

describe('getRiskBreakdown', () => {
    it('should return breakdown with descriptions', () => {
        const factors: RiskFactors = {
            storyCount: 3,
            estimatedFiles: 5,
            hasMigrations: true,
            hasApiChanges: false,
            taskType: 'feature',
        };

        const breakdown = getRiskBreakdown(factors);

        expect(breakdown.storyCount).toBeDefined();
        expect(breakdown.storyCount.description).toContain('3 user stories');
        expect(breakdown.dbMigrations.description).toContain('migrations required');
    });
});
