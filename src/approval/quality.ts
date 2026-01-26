/**
 * PRD Quality Scoring
 * Scores PRD quality to prioritize review and predict agent success rates
 */

import type { PrdJson, RiskFactors } from '../types.js';
import type { CodebaseAnalysis } from '../analysis/types.js';

export interface QualityFactor {
    name: string;
    score: number; // 0-100
    weight: number; // 0-1
    issues: string[];
    suggestions: string[];
}

export interface QualityScore {
    overall: number; // 0-100
    confidence: number; // 0-100 (confidence in agent success)
    factors: QualityFactor[];
    issues: string[]; // All issues aggregated
    suggestions: string[]; // All suggestions aggregated
    grade: 'A' | 'B' | 'C' | 'D' | 'F';
}

/**
 * Calculate quality score for a PRD
 */
export function calculateQualityScore(
    prdContent: string,
    prdJson: PrdJson,
    codebaseAnalysis?: CodebaseAnalysis | null
): QualityScore {
    const factors: QualityFactor[] = [
        evaluateCompleteness(prdContent, prdJson),
        evaluateClarity(prdContent, prdJson),
        evaluateFeasibility(prdJson),
        evaluateAtomicity(prdJson),
        evaluateCodebaseAlignment(prdContent, codebaseAnalysis),
        evaluateAcceptanceCriteria(prdJson),
    ];

    // Calculate weighted overall score
    const totalWeight = factors.reduce((sum, f) => sum + f.weight, 0);
    const weightedSum = factors.reduce((sum, f) => sum + f.score * f.weight, 0);
    const overall = Math.round(weightedSum / totalWeight);

    // Aggregate issues and suggestions
    const issues = factors.flatMap(f => f.issues);
    const suggestions = factors.flatMap(f => f.suggestions);

    // Calculate confidence (how likely the agent will succeed)
    const confidence = calculateConfidence(overall, factors, prdJson);

    // Determine grade
    const grade = getGrade(overall);

    return {
        overall,
        confidence,
        factors,
        issues,
        suggestions,
        grade,
    };
}

/**
 * Evaluate completeness of the PRD
 */
function evaluateCompleteness(prdContent: string, prdJson: PrdJson): QualityFactor {
    const issues: string[] = [];
    const suggestions: string[] = [];
    let score = 100;

    // Check PRD content length
    const contentLength = prdContent.length;
    if (contentLength < 500) {
        score -= 30;
        issues.push('PRD content is too brief (< 500 chars)');
        suggestions.push('Add more detail about requirements and implementation approach');
    } else if (contentLength < 1000) {
        score -= 15;
        issues.push('PRD content could be more detailed');
    }

    // Check for key sections
    const contentLower = prdContent.toLowerCase();
    const keySections = [
        { name: 'summary', patterns: ['summary', 'overview', 'introduction'], required: true },
        { name: 'acceptance criteria', patterns: ['acceptance criteria', 'requirements'], required: true },
        { name: 'technical details', patterns: ['technical', 'implementation', 'architecture'], required: false },
    ];

    for (const section of keySections) {
        const found = section.patterns.some(p => contentLower.includes(p));
        if (!found && section.required) {
            score -= 15;
            issues.push(`Missing ${section.name} section`);
            suggestions.push(`Add a ${section.name} section to the PRD`);
        } else if (!found) {
            score -= 5;
            suggestions.push(`Consider adding ${section.name} section`);
        }
    }

    // Check user stories
    if (prdJson.userStories.length === 0) {
        score -= 40;
        issues.push('No user stories defined');
        suggestions.push('Add at least one user story with clear acceptance criteria');
    }

    // Check description
    if (!prdJson.description || prdJson.description.length < 20) {
        score -= 10;
        issues.push('PRD description is too brief');
    }

    return {
        name: 'Completeness',
        score: Math.max(0, score),
        weight: 0.25,
        issues,
        suggestions,
    };
}

/**
 * Evaluate clarity of the PRD
 */
function evaluateClarity(prdContent: string, prdJson: PrdJson): QualityFactor {
    const issues: string[] = [];
    const suggestions: string[] = [];
    let score = 100;

    // Check for vague language
    const vagueTerms = [
        'should work', 'might need', 'possibly', 'maybe', 'etc',
        'and so on', 'things like', 'some kind of', 'somehow',
    ];
    const contentLower = prdContent.toLowerCase();
    const foundVague = vagueTerms.filter(term => contentLower.includes(term));
    if (foundVague.length > 0) {
        score -= foundVague.length * 5;
        issues.push(`Contains vague language: ${foundVague.slice(0, 3).join(', ')}`);
        suggestions.push('Replace vague terms with specific, concrete language');
    }

    // Check user story descriptions
    for (const story of prdJson.userStories) {
        // Check for proper "As a... I want... so that..." format
        const hasUserStoryFormat = /as a.+i want.+so that/i.test(story.description);
        if (!hasUserStoryFormat && !story.description.toLowerCase().includes('as a')) {
            score -= 5;
            issues.push(`User story "${story.title}" doesn't follow standard format`);
        }

        // Check title clarity
        if (story.title.length < 10) {
            score -= 3;
            suggestions.push(`Story "${story.title}" could have a more descriptive title`);
        }
    }

    // Check for ambiguous requirements
    const ambiguousPatterns = [
        /\bfast\b(?!api|ify)/i,
        /\beasy\b/i,
        /\bsimple\b/i,
        /\bnice\b/i,
        /\bgood\b/i,
    ];
    for (const pattern of ambiguousPatterns) {
        if (pattern.test(prdContent)) {
            score -= 5;
            suggestions.push('Define measurable criteria instead of subjective terms');
            break;
        }
    }

    return {
        name: 'Clarity',
        score: Math.max(0, score),
        weight: 0.20,
        issues,
        suggestions,
    };
}

/**
 * Evaluate feasibility of the PRD
 */
function evaluateFeasibility(prdJson: PrdJson): QualityFactor {
    const issues: string[] = [];
    const suggestions: string[] = [];
    let score = 100;

    // Check story count
    const storyCount = prdJson.userStories.length;
    if (storyCount > 10) {
        score -= 20;
        issues.push(`Too many user stories (${storyCount}) - may be too complex`);
        suggestions.push('Consider breaking into multiple PRDs');
    } else if (storyCount > 7) {
        score -= 10;
        suggestions.push('Consider reducing scope or splitting into phases');
    }

    // Check for blocking dependencies
    const storyTexts = prdJson.userStories.map(s =>
        `${s.title} ${s.description}`.toLowerCase()
    );
    const complexIndicators = ['database migration', 'breaking change', 'refactor', 'rewrite'];
    const hasComplexWork = complexIndicators.some(ind =>
        storyTexts.some(text => text.includes(ind))
    );
    if (hasComplexWork) {
        score -= 15;
        issues.push('Contains potentially complex/risky work');
        suggestions.push('Ensure complex changes are isolated in their own stories');
    }

    // Check for external dependencies
    const externalIndicators = ['third-party', 'external api', 'vendor', 'library upgrade'];
    const hasExternal = externalIndicators.some(ind =>
        storyTexts.some(text => text.includes(ind))
    );
    if (hasExternal) {
        score -= 10;
        issues.push('May have external dependencies');
        suggestions.push('Document external dependencies and fallback plans');
    }

    return {
        name: 'Feasibility',
        score: Math.max(0, score),
        weight: 0.15,
        issues,
        suggestions,
    };
}

/**
 * Evaluate atomicity of user stories
 */
function evaluateAtomicity(prdJson: PrdJson): QualityFactor {
    const issues: string[] = [];
    const suggestions: string[] = [];
    let score = 100;

    for (const story of prdJson.userStories) {
        const text = `${story.title} ${story.description}`.toLowerCase();

        // Check for multiple distinct tasks
        const andCount = (text.match(/\band\b/g) || []).length;
        if (andCount >= 2) {
            score -= 10;
            issues.push(`Story "${story.title}" may combine multiple tasks`);
            suggestions.push(`Consider splitting "${story.title}" into smaller stories`);
        }

        // Check acceptance criteria count
        const criteriaCount = story.acceptanceCriteria.length;
        if (criteriaCount > 7) {
            score -= 10;
            issues.push(`Story "${story.title}" has ${criteriaCount} criteria - may be too large`);
        } else if (criteriaCount < 2) {
            score -= 5;
            suggestions.push(`Story "${story.title}" should have more acceptance criteria`);
        }

        // Check for "Typecheck passes" requirement
        const hasTypecheck = story.acceptanceCriteria.some(c =>
            c.toLowerCase().includes('typecheck')
        );
        if (!hasTypecheck) {
            score -= 5;
            issues.push(`Story "${story.title}" missing "Typecheck passes" criterion`);
        }
    }

    return {
        name: 'Atomicity',
        score: Math.max(0, score),
        weight: 0.20,
        issues,
        suggestions,
    };
}

/**
 * Evaluate alignment with codebase patterns
 */
function evaluateCodebaseAlignment(
    prdContent: string,
    analysis?: CodebaseAnalysis | null
): QualityFactor {
    const issues: string[] = [];
    const suggestions: string[] = [];
    let score = 100;

    if (!analysis) {
        return {
            name: 'Codebase Alignment',
            score: 70, // Neutral score when no analysis
            weight: 0.10,
            issues: ['No codebase analysis available'],
            suggestions: ['Run `fleet analyze` to improve PRD quality scoring'],
        };
    }

    const contentLower = prdContent.toLowerCase();

    // Check if PRD references existing patterns
    const patternsReferenced = analysis.patterns.filter(p =>
        contentLower.includes(p.name.toLowerCase()) ||
        p.examples.some(e => contentLower.includes(e.toLowerCase()))
    );

    if (patternsReferenced.length === 0 && analysis.patterns.length > 0) {
        score -= 20;
        issues.push('PRD does not reference existing code patterns');
        suggestions.push('Reference existing patterns for consistency');
    }

    // Check framework alignment
    const frameworksMentioned = analysis.frameworks.filter(f =>
        contentLower.includes(f.name.toLowerCase())
    );
    if (frameworksMentioned.length === 0 && analysis.frameworks.length > 0) {
        score -= 10;
        suggestions.push(`Consider referencing project frameworks: ${analysis.frameworks.map(f => f.name).join(', ')}`);
    }

    // Check for convention alignment
    if (analysis.conventions.typeSystem === 'typescript') {
        if (!contentLower.includes('typescript') && !contentLower.includes('type')) {
            suggestions.push('Consider mentioning TypeScript requirements');
        }
    }

    if (analysis.conventions.testFramework) {
        if (!contentLower.includes('test') && !contentLower.includes(analysis.conventions.testFramework)) {
            score -= 5;
            suggestions.push(`Add testing requirements (project uses ${analysis.conventions.testFramework})`);
        }
    }

    return {
        name: 'Codebase Alignment',
        score: Math.max(0, score),
        weight: 0.10,
        issues,
        suggestions,
    };
}

/**
 * Evaluate acceptance criteria quality
 */
function evaluateAcceptanceCriteria(prdJson: PrdJson): QualityFactor {
    const issues: string[] = [];
    const suggestions: string[] = [];
    let score = 100;

    for (const story of prdJson.userStories) {
        for (const criterion of story.acceptanceCriteria) {
            // Check criterion length
            if (criterion.length < 10) {
                score -= 5;
                suggestions.push(`Criterion "${criterion}" is too brief`);
            }

            // Check for measurability
            const measurablePatterns = [
                /\d+/, // Contains numbers
                /must|should|shall/i,
                /when|if|given|then/i,
                /pass|fail|return|display|show/i,
            ];
            const isMeasurable = measurablePatterns.some(p => p.test(criterion));
            if (!isMeasurable) {
                score -= 3;
            }
        }
    }

    // Check total criteria count
    const totalCriteria = prdJson.userStories.reduce(
        (sum, s) => sum + s.acceptanceCriteria.length, 0
    );
    if (totalCriteria < prdJson.userStories.length * 2) {
        issues.push('Some stories may have insufficient acceptance criteria');
        suggestions.push('Ensure each story has at least 2 acceptance criteria');
    }

    return {
        name: 'Acceptance Criteria',
        score: Math.max(0, score),
        weight: 0.10,
        issues,
        suggestions,
    };
}

/**
 * Calculate confidence in agent success
 */
function calculateConfidence(
    overallScore: number,
    factors: QualityFactor[],
    prdJson: PrdJson
): number {
    let confidence = overallScore;

    // Adjust based on story count (fewer = higher confidence)
    const storyCount = prdJson.userStories.length;
    if (storyCount <= 3) {
        confidence += 10;
    } else if (storyCount >= 7) {
        confidence -= 10;
    }

    // Adjust based on critical issues
    const criticalIssues = factors.flatMap(f => f.issues).filter(i =>
        i.toLowerCase().includes('missing') ||
        i.toLowerCase().includes('no user stories') ||
        i.toLowerCase().includes('too complex')
    );
    confidence -= criticalIssues.length * 5;

    // Atomicity factor heavily impacts confidence
    const atomicityFactor = factors.find(f => f.name === 'Atomicity');
    if (atomicityFactor && atomicityFactor.score < 70) {
        confidence -= 15;
    }

    return Math.max(0, Math.min(100, Math.round(confidence)));
}

/**
 * Get letter grade from score
 */
function getGrade(score: number): 'A' | 'B' | 'C' | 'D' | 'F' {
    if (score >= 90) return 'A';
    if (score >= 80) return 'B';
    if (score >= 70) return 'C';
    if (score >= 60) return 'D';
    return 'F';
}

/**
 * Format quality score for display
 */
export function formatQualityScore(quality: QualityScore): string {
    const parts: string[] = [];

    // Header with grade and scores
    parts.push(`Quality: ${quality.grade} (${quality.overall}/100) | Confidence: ${quality.confidence}%`);
    parts.push('');

    // Factor breakdown
    parts.push('Factor Breakdown:');
    for (const factor of quality.factors) {
        const bar = '█'.repeat(Math.floor(factor.score / 10));
        const empty = '░'.repeat(10 - Math.floor(factor.score / 10));
        parts.push(`  ${factor.name.padEnd(20)} ${bar}${empty} ${factor.score}`);
    }

    // Issues
    if (quality.issues.length > 0) {
        parts.push('');
        parts.push('Issues:');
        for (const issue of quality.issues.slice(0, 5)) {
            parts.push(`  ⚠️ ${issue}`);
        }
        if (quality.issues.length > 5) {
            parts.push(`  ... and ${quality.issues.length - 5} more`);
        }
    }

    // Suggestions
    if (quality.suggestions.length > 0) {
        parts.push('');
        parts.push('Suggestions:');
        for (const suggestion of quality.suggestions.slice(0, 3)) {
            parts.push(`  💡 ${suggestion}`);
        }
    }

    return parts.join('\n');
}
