import type { RiskFactors, PrdJson } from '../types.js';

interface WeightedFactor {
    weight: number;
    calculate: (factors: RiskFactors) => number;
}

const RISK_WEIGHTS: Record<string, WeightedFactor> = {
    storyCount: {
        weight: 0.30,
        calculate: (factors) => Math.min(factors.storyCount * 10, 50),
    },
    fileTouches: {
        weight: 0.25,
        calculate: (factors) => Math.min(factors.estimatedFiles * 5, 50),
    },
    dbMigrations: {
        weight: 0.20,
        calculate: (factors) => factors.hasMigrations ? 40 : 0,
    },
    apiChanges: {
        weight: 0.15,
        calculate: (factors) => factors.hasApiChanges ? 30 : 0,
    },
    taskType: {
        weight: 0.10,
        calculate: (factors) => {
            switch (factors.taskType) {
                case 'bug': return 10;
                case 'chore': return 20;
                case 'feature': return 40;
                case 'refactor': return 50;
                default: return 25;
            }
        },
    },
};

/**
 * Calculate risk score from 0-100
 */
export function calculateRiskScore(factors: RiskFactors): number {
    let score = 0;

    for (const [, config] of Object.entries(RISK_WEIGHTS)) {
        score += config.weight * config.calculate(factors);
    }

    return Math.round(Math.min(100, Math.max(0, score)));
}

/**
 * Extract risk factors from PRD content and JSON
 */
export function extractRiskFactors(
    prdContent: string,
    prdJson: PrdJson,
    taskType: RiskFactors['taskType']
): RiskFactors {
    const contentLower = prdContent.toLowerCase();

    // Count user stories
    const storyCount = prdJson.userStories.length;

    // Estimate files from PRD content
    const filePatterns = [
        /\.(ts|tsx|js|jsx|py|rb|go|rs|java|sql|css|scss)['"`]/gi,
        /create\s+(?:a\s+)?(?:new\s+)?(?:file|component|module|class)/gi,
        /modify\s+(?:the\s+)?(?:file|component|module|class)/gi,
    ];
    let estimatedFiles = 0;
    for (const pattern of filePatterns) {
        const matches = contentLower.match(pattern);
        estimatedFiles += matches?.length || 0;
    }
    // Add base estimate from story count
    estimatedFiles = Math.max(estimatedFiles, storyCount * 2);

    // Detect migrations
    const migrationIndicators = [
        'migration',
        'schema change',
        'alter table',
        'add column',
        'drop column',
        'database change',
        'prisma migrate',
        'drizzle migrate',
    ];
    const hasMigrations = migrationIndicators.some(indicator =>
        contentLower.includes(indicator)
    );

    // Detect API changes
    const apiIndicators = [
        'api endpoint',
        'new endpoint',
        'modify endpoint',
        'api change',
        'rest api',
        'graphql',
        'route handler',
        'server action',
    ];
    const hasApiChanges = apiIndicators.some(indicator =>
        contentLower.includes(indicator)
    );

    return {
        storyCount,
        estimatedFiles,
        hasMigrations,
        hasApiChanges,
        taskType,
    };
}

/**
 * Get risk breakdown for display
 */
export function getRiskBreakdown(factors: RiskFactors): Record<string, { score: number; description: string }> {
    return {
        storyCount: {
            score: Math.round(RISK_WEIGHTS.storyCount.weight * RISK_WEIGHTS.storyCount.calculate(factors)),
            description: `${factors.storyCount} user stories`,
        },
        fileTouches: {
            score: Math.round(RISK_WEIGHTS.fileTouches.weight * RISK_WEIGHTS.fileTouches.calculate(factors)),
            description: `~${factors.estimatedFiles} files affected`,
        },
        dbMigrations: {
            score: Math.round(RISK_WEIGHTS.dbMigrations.weight * RISK_WEIGHTS.dbMigrations.calculate(factors)),
            description: factors.hasMigrations ? 'Database migrations required' : 'No migrations',
        },
        apiChanges: {
            score: Math.round(RISK_WEIGHTS.apiChanges.weight * RISK_WEIGHTS.apiChanges.calculate(factors)),
            description: factors.hasApiChanges ? 'API changes required' : 'No API changes',
        },
        taskType: {
            score: Math.round(RISK_WEIGHTS.taskType.weight * RISK_WEIGHTS.taskType.calculate(factors)),
            description: `Task type: ${factors.taskType}`,
        },
    };
}

/**
 * Determine approval requirement based on score and config
 */
export function determineApprovalRequirement(
    score: number,
    taskType: RiskFactors['taskType'],
    autoApproveThreshold: number,
    requireApprovalTypes: string[]
): 'auto-approve' | 'review' | 'require-approval' {
    // Always require approval for certain task types
    if (requireApprovalTypes.includes(taskType)) {
        if (score > 70) return 'require-approval';
        return 'review';
    }

    // Score-based determination
    if (score < autoApproveThreshold) return 'auto-approve';
    if (score <= 70) return 'review';
    return 'require-approval';
}
