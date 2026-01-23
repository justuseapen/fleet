import { Command } from 'commander';
import { generateBriefing, getBriefingData } from '../../briefing/generator.js';

export const statusCommand = new Command('status')
    .description('Morning briefing - overnight work, pending approvals, priorities')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
        if (options.json) {
            const data = getBriefingData();
            console.log(JSON.stringify(data, null, 2));
        } else {
            const briefing = generateBriefing();
            console.log(briefing);
        }
    });
