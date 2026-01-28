import { describe, it, expect, beforeEach } from 'vitest';
import { getBriefingData, generateBriefing } from './generator.js';

describe('briefing generator', () => {
    describe('getBriefingData', () => {
        it('should return valid BriefingData structure', () => {
            const data = getBriefingData();

            expect(data).toHaveProperty('completedOvernight');
            expect(data).toHaveProperty('pendingApprovals');
            expect(data).toHaveProperty('blockedOrFailed');
            expect(data).toHaveProperty('runningNow');
            expect(data).toHaveProperty('suggestedPriorities');

            expect(Array.isArray(data.completedOvernight)).toBe(true);
            expect(Array.isArray(data.pendingApprovals)).toBe(true);
            expect(Array.isArray(data.blockedOrFailed)).toBe(true);
            expect(Array.isArray(data.runningNow)).toBe(true);
            expect(Array.isArray(data.suggestedPriorities)).toBe(true);
        });

        it('should return data that is JSON serializable', () => {
            const data = getBriefingData();

            // This should not throw
            const json = JSON.stringify(data);
            expect(json).toBeTruthy();

            // Should be parseable back
            const parsed = JSON.parse(json);
            expect(parsed).toEqual(data);
        });

        it('should have proper structure for completedOvernight items', () => {
            const data = getBriefingData();

            for (const item of data.completedOvernight) {
                expect(item).toHaveProperty('project');
                expect(item).toHaveProperty('summary');
                expect(typeof item.project).toBe('string');
                expect(typeof item.summary).toBe('string');
                // prUrl is optional
                if (item.prUrl) {
                    expect(typeof item.prUrl).toBe('string');
                }
            }
        });

        it('should have proper structure for pendingApprovals items', () => {
            const data = getBriefingData();

            for (const item of data.pendingApprovals) {
                expect(item).toHaveProperty('project');
                expect(item).toHaveProperty('task');
                expect(item).toHaveProperty('riskLevel');
                expect(item).toHaveProperty('riskScore');
                expect(typeof item.project).toBe('string');
                expect(typeof item.task).toBe('string');
                expect(['LOW', 'MED', 'HIGH']).toContain(item.riskLevel);
                expect(typeof item.riskScore).toBe('number');
            }
        });

        it('should have proper structure for blockedOrFailed items', () => {
            const data = getBriefingData();

            for (const item of data.blockedOrFailed) {
                expect(item).toHaveProperty('project');
                expect(item).toHaveProperty('summary');
                expect(typeof item.project).toBe('string');
                expect(typeof item.summary).toBe('string');
                // error is optional
                if (item.error) {
                    expect(typeof item.error).toBe('string');
                }
            }
        });

        it('should have proper structure for runningNow items', () => {
            const data = getBriefingData();

            for (const item of data.runningNow) {
                expect(item).toHaveProperty('project');
                expect(item).toHaveProperty('branch');
                expect(item).toHaveProperty('iterations');
                expect(typeof item.project).toBe('string');
                expect(typeof item.branch).toBe('string');
                expect(typeof item.iterations).toBe('string');
            }
        });

        it('should have proper structure for suggestedPriorities items', () => {
            const data = getBriefingData();

            for (const item of data.suggestedPriorities) {
                expect(item).toHaveProperty('project');
                expect(item).toHaveProperty('task');
                expect(item).toHaveProperty('reason');
                expect(typeof item.project).toBe('string');
                expect(typeof item.task).toBe('string');
                expect(typeof item.reason).toBe('string');
            }
        });

        it('should limit suggestedPriorities to 5 items', () => {
            const data = getBriefingData();

            expect(data.suggestedPriorities.length).toBeLessThanOrEqual(5);
        });
    });

    describe('generateBriefing', () => {
        it('should return a non-empty string', () => {
            const briefing = generateBriefing();

            expect(typeof briefing).toBe('string');
            expect(briefing.length).toBeGreaterThan(0);
        });

        it('should contain heading', () => {
            const briefing = generateBriefing();

            // Should contain the briefing heading (without ANSI codes)
            expect(briefing).toContain('Fleet Morning Briefing');
        });

        it('should not contain JSON', () => {
            const briefing = generateBriefing();

            // Terminal output should not start with {
            expect(briefing.trim()[0]).not.toBe('{');
        });
    });
});
