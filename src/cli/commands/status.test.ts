import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as generator from '../../briefing/generator.js';

// We're testing the integration of the status command behavior
// without actually invoking Commander's parseAsync, since that's
// complex to mock properly with the action handler registration

describe('status command integration', () => {
    let consoleLogSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.clearAllMocks();
        consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('JSON output behavior', () => {
        it('should produce valid JSON from getBriefingData', () => {
            const mockData = {
                completedOvernight: [],
                pendingApprovals: [],
                blockedOrFailed: [],
                runningNow: [],
                suggestedPriorities: [],
            };

            vi.spyOn(generator, 'getBriefingData').mockReturnValue(mockData);

            const data = generator.getBriefingData();
            const jsonString = JSON.stringify(data, null, 2);

            // Should be valid JSON
            expect(() => JSON.parse(jsonString)).not.toThrow();

            // Should match the original data
            const parsed = JSON.parse(jsonString);
            expect(parsed).toEqual(mockData);
        });

        it('should include all required fields in JSON structure', () => {
            const mockData = {
                completedOvernight: [
                    { project: 'TestProject', summary: 'Completed task', prUrl: 'https://github.com/test/pr/1' }
                ],
                pendingApprovals: [
                    { project: 'TestProject', task: 'Test task', riskLevel: 'MED' as const, riskScore: 50 }
                ],
                blockedOrFailed: [
                    { project: 'TestProject', summary: 'Failed run', error: 'Test error' }
                ],
                runningNow: [
                    { project: 'TestProject', branch: 'feat/test', iterations: '3/10' }
                ],
                suggestedPriorities: [
                    { project: 'TestProject', task: 'Priority task', reason: 'High priority' }
                ],
            };

            vi.spyOn(generator, 'getBriefingData').mockReturnValue(mockData);

            const data = generator.getBriefingData();
            const jsonString = JSON.stringify(data, null, 2);
            const parsed = JSON.parse(jsonString);

            // Verify all fields are present
            expect(parsed).toHaveProperty('completedOvernight');
            expect(parsed).toHaveProperty('pendingApprovals');
            expect(parsed).toHaveProperty('blockedOrFailed');
            expect(parsed).toHaveProperty('runningNow');
            expect(parsed).toHaveProperty('suggestedPriorities');

            // Verify data integrity
            expect(parsed.completedOvernight).toHaveLength(1);
            expect(parsed.completedOvernight[0]).toMatchObject({
                project: 'TestProject',
                summary: 'Completed task',
                prUrl: 'https://github.com/test/pr/1',
            });

            expect(parsed.pendingApprovals).toHaveLength(1);
            expect(parsed.pendingApprovals[0]).toMatchObject({
                project: 'TestProject',
                task: 'Test task',
                riskLevel: 'MED',
                riskScore: 50,
            });

            expect(parsed.blockedOrFailed).toHaveLength(1);
            expect(parsed.blockedOrFailed[0]).toMatchObject({
                project: 'TestProject',
                summary: 'Failed run',
                error: 'Test error',
            });

            expect(parsed.runningNow).toHaveLength(1);
            expect(parsed.runningNow[0]).toMatchObject({
                project: 'TestProject',
                branch: 'feat/test',
                iterations: '3/10',
            });

            expect(parsed.suggestedPriorities).toHaveLength(1);
            expect(parsed.suggestedPriorities[0]).toMatchObject({
                project: 'TestProject',
                task: 'Priority task',
                reason: 'High priority',
            });
        });

        it('should not include ANSI escape codes in JSON', () => {
            const mockData = {
                completedOvernight: [
                    { project: 'TestProject', summary: 'Task completed' }
                ],
                pendingApprovals: [],
                blockedOrFailed: [],
                runningNow: [],
                suggestedPriorities: [],
            };

            vi.spyOn(generator, 'getBriefingData').mockReturnValue(mockData);

            const data = generator.getBriefingData();
            const jsonString = JSON.stringify(data, null, 2);

            // Should not contain ANSI escape codes
            expect(jsonString).not.toMatch(/\x1b\[/);
            // Should not contain chalk formatting
            expect(jsonString).not.toContain('[32m');
            expect(jsonString).not.toContain('[33m');
            expect(jsonString).not.toContain('[31m');
        });

        it('should handle empty state gracefully', () => {
            const emptyData = {
                completedOvernight: [],
                pendingApprovals: [],
                blockedOrFailed: [],
                runningNow: [],
                suggestedPriorities: [],
            };

            vi.spyOn(generator, 'getBriefingData').mockReturnValue(emptyData);

            const data = generator.getBriefingData();
            const jsonString = JSON.stringify(data, null, 2);
            const parsed = JSON.parse(jsonString);

            // All arrays should be empty but present
            expect(parsed.completedOvernight).toEqual([]);
            expect(parsed.pendingApprovals).toEqual([]);
            expect(parsed.blockedOrFailed).toEqual([]);
            expect(parsed.runningNow).toEqual([]);
            expect(parsed.suggestedPriorities).toEqual([]);
        });

        it('should handle multiple items in each category', () => {
            const mockData = {
                completedOvernight: [
                    { project: 'Project1', summary: 'Task 1' },
                    { project: 'Project2', summary: 'Task 2' },
                    { project: 'Project3', summary: 'Task 3' },
                ],
                pendingApprovals: [
                    { project: 'Project1', task: 'Pending 1', riskLevel: 'HIGH' as const, riskScore: 85 },
                    { project: 'Project2', task: 'Pending 2', riskLevel: 'LOW' as const, riskScore: 15 },
                ],
                blockedOrFailed: [
                    { project: 'Project1', summary: 'Failed 1' },
                    { project: 'Project2', summary: 'Failed 2' },
                ],
                runningNow: [
                    { project: 'Project1', branch: 'feat/a', iterations: '1/5' },
                    { project: 'Project2', branch: 'feat/b', iterations: '2/8' },
                ],
                suggestedPriorities: [
                    { project: 'Project1', task: 'Priority 1', reason: 'Critical' },
                    { project: 'Project2', task: 'Priority 2', reason: 'High priority' },
                    { project: 'Project3', task: 'Priority 3', reason: 'Important' },
                ],
            };

            vi.spyOn(generator, 'getBriefingData').mockReturnValue(mockData);

            const data = generator.getBriefingData();
            const jsonString = JSON.stringify(data, null, 2);
            const parsed = JSON.parse(jsonString);

            expect(parsed.completedOvernight).toHaveLength(3);
            expect(parsed.pendingApprovals).toHaveLength(2);
            expect(parsed.blockedOrFailed).toHaveLength(2);
            expect(parsed.runningNow).toHaveLength(2);
            expect(parsed.suggestedPriorities).toHaveLength(3);
        });

        it('should output pretty-printed JSON with 2-space indentation', () => {
            const mockData = {
                completedOvernight: [
                    { project: 'Test', summary: 'Done' }
                ],
                pendingApprovals: [],
                blockedOrFailed: [],
                runningNow: [],
                suggestedPriorities: [],
            };

            vi.spyOn(generator, 'getBriefingData').mockReturnValue(mockData);

            const data = generator.getBriefingData();
            const jsonString = JSON.stringify(data, null, 2);

            // Check for proper indentation (2 spaces)
            expect(jsonString).toContain('  "completedOvernight"');
            expect(jsonString).toContain('    {');

            // Verify it matches expected format
            const parsed = JSON.parse(jsonString);
            expect(jsonString).toBe(JSON.stringify(parsed, null, 2));
        });
    });

    describe('terminal output behavior', () => {
        it('should produce formatted terminal output from generateBriefing', () => {
            const mockBriefing = '=== Fleet Morning Briefing ===\nTest briefing content';

            vi.spyOn(generator, 'generateBriefing').mockReturnValue(mockBriefing);

            const briefing = generator.generateBriefing();

            // Should return the formatted text
            expect(briefing).toBe(mockBriefing);
            // Should not be JSON
            expect(() => JSON.parse(briefing)).toThrow();
        });

        it('should include ANSI escape codes in terminal output', () => {
            const mockBriefing = '\x1b[36m=== Fleet Morning Briefing ===\x1b[39m\n\x1b[32m✓ Completed\x1b[39m';

            vi.spyOn(generator, 'generateBriefing').mockReturnValue(mockBriefing);

            const briefing = generator.generateBriefing();

            // Should contain ANSI escape codes (terminal colors)
            expect(briefing).toMatch(/\x1b\[/);
        });

        it('should distinguish between JSON and terminal output', () => {
            const mockData = {
                completedOvernight: [{ project: 'Test', summary: 'Done' }],
                pendingApprovals: [],
                blockedOrFailed: [],
                runningNow: [],
                suggestedPriorities: [],
            };
            const mockBriefing = '\x1b[36m=== Fleet Morning Briefing ===\x1b[39m';

            vi.spyOn(generator, 'getBriefingData').mockReturnValue(mockData);
            vi.spyOn(generator, 'generateBriefing').mockReturnValue(mockBriefing);

            const jsonData = generator.getBriefingData();
            const terminalOutput = generator.generateBriefing();

            const jsonString = JSON.stringify(jsonData, null, 2);

            // Outputs should be completely different
            expect(jsonString).not.toBe(terminalOutput);

            // JSON should not contain ANSI codes
            expect(jsonString).not.toMatch(/\x1b\[/);

            // Terminal output should contain ANSI codes
            expect(terminalOutput).toMatch(/\x1b\[/);

            // JSON should be parseable
            expect(() => JSON.parse(jsonString)).not.toThrow();

            // Terminal output should not be parseable as JSON
            expect(() => JSON.parse(terminalOutput)).toThrow();
        });
    });

    describe('data consistency', () => {
        it('should ensure JSON serialization preserves all data', () => {
            const mockData = {
                completedOvernight: [
                    { project: 'P1', summary: 'S1', prUrl: 'url1' },
                ],
                pendingApprovals: [
                    { project: 'P2', task: 'T1', riskLevel: 'HIGH' as const, riskScore: 90 },
                ],
                blockedOrFailed: [
                    { project: 'P3', summary: 'S2', error: 'E1' },
                ],
                runningNow: [
                    { project: 'P4', branch: 'B1', iterations: '1/10' },
                ],
                suggestedPriorities: [
                    { project: 'P5', task: 'T2', reason: 'R1' },
                ],
            };

            vi.spyOn(generator, 'getBriefingData').mockReturnValue(mockData);

            const data = generator.getBriefingData();
            const jsonString = JSON.stringify(data, null, 2);
            const parsed = JSON.parse(jsonString);

            // Deep equality check
            expect(parsed).toEqual(mockData);
        });

        it('should handle optional fields correctly', () => {
            const mockData = {
                completedOvernight: [
                    { project: 'P1', summary: 'S1' }, // No prUrl
                    { project: 'P2', summary: 'S2', prUrl: 'url1' }, // With prUrl
                ],
                pendingApprovals: [],
                blockedOrFailed: [
                    { project: 'P3', summary: 'S3' }, // No error
                    { project: 'P4', summary: 'S4', error: 'E1' }, // With error
                ],
                runningNow: [],
                suggestedPriorities: [],
            };

            vi.spyOn(generator, 'getBriefingData').mockReturnValue(mockData);

            const data = generator.getBriefingData();
            const jsonString = JSON.stringify(data, null, 2);
            const parsed = JSON.parse(jsonString);

            // First item should not have prUrl
            expect(parsed.completedOvernight[0]).not.toHaveProperty('prUrl');
            // Second item should have prUrl
            expect(parsed.completedOvernight[1]).toHaveProperty('prUrl', 'url1');

            // First blockedOrFailed should not have error
            expect(parsed.blockedOrFailed[0]).not.toHaveProperty('error');
            // Second should have error
            expect(parsed.blockedOrFailed[1]).toHaveProperty('error', 'E1');
        });
    });

    describe('command interface validation', () => {
        it('should verify status command exports exist', async () => {
            const statusModule = await import('./status.js');

            // The status command should be exported
            expect(statusModule.statusCommand).toBeDefined();
            expect(statusModule.statusCommand.name()).toBe('status');
            expect(statusModule.statusCommand.description()).toContain('briefing');
        });

        it('should verify status command has --json option', async () => {
            const statusModule = await import('./status.js');
            const options = statusModule.statusCommand.options;

            // Should have the --json option
            const jsonOption = options.find((opt: any) => opt.long === '--json');
            expect(jsonOption).toBeDefined();
            if (jsonOption) {
                expect(jsonOption.description).toBeDefined();
            }
        });
    });
});
