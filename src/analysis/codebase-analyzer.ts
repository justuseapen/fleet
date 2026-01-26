/**
 * Codebase Analyzer
 * Main class for analyzing project codebases to inform PRD generation
 */

import { existsSync } from 'fs';
import type { CodebaseAnalysis, AnalysisCacheEntry } from './types.js';
import { PatternDetector } from './pattern-detector.js';
import { getDb, generateId } from '../db/index.js';

// Cache duration: 7 days
const CACHE_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

export class CodebaseAnalyzer {
    /**
     * Analyze a project codebase, using cache if available
     */
    async analyze(projectId: string, projectPath: string, forceRefresh = false): Promise<CodebaseAnalysis> {
        if (!existsSync(projectPath)) {
            throw new Error(`Project path does not exist: ${projectPath}`);
        }

        // Check cache first
        if (!forceRefresh) {
            const cached = this.getFromCache(projectId);
            if (cached) {
                return cached;
            }
        }

        // Perform fresh analysis
        const analysis = await this.performAnalysis(projectId, projectPath);

        // Save to cache
        this.saveToCache(projectId, analysis);

        return analysis;
    }

    /**
     * Get analysis from cache if valid
     */
    getFromCache(projectId: string): CodebaseAnalysis | null {
        try {
            const db = getDb();
            const entry = db.prepare(`
                SELECT * FROM codebase_analysis
                WHERE project_id = ? AND expires_at > datetime('now')
            `).get(projectId) as AnalysisCacheEntry | undefined;

            if (entry) {
                return JSON.parse(entry.analysis_data) as CodebaseAnalysis;
            }
        } catch {
            // Cache miss or error
        }
        return null;
    }

    /**
     * Save analysis to cache
     */
    private saveToCache(projectId: string, analysis: CodebaseAnalysis): void {
        try {
            const db = getDb();
            const id = generateId();
            const analysisData = JSON.stringify(analysis);
            const expiresAt = new Date(Date.now() + CACHE_DURATION_MS).toISOString();

            db.prepare(`
                INSERT OR REPLACE INTO codebase_analysis (id, project_id, analysis_data, analyzed_at, expires_at)
                VALUES (?, ?, ?, datetime('now'), ?)
            `).run(id, projectId, analysisData, expiresAt);
        } catch (error) {
            // Log but don't fail if caching fails
            console.error('Failed to cache codebase analysis:', error);
        }
    }

    /**
     * Invalidate cache for a project
     */
    invalidateCache(projectId: string): void {
        try {
            const db = getDb();
            db.prepare('DELETE FROM codebase_analysis WHERE project_id = ?').run(projectId);
        } catch {
            // Ignore errors
        }
    }

    /**
     * Perform fresh codebase analysis
     */
    private async performAnalysis(projectId: string, projectPath: string): Promise<CodebaseAnalysis> {
        const detector = new PatternDetector(projectPath);

        const [frameworks, patterns, fileStructure, languages, dependencies, conventions] = await Promise.all([
            Promise.resolve(detector.detectFrameworks()),
            Promise.resolve(detector.detectPatterns()),
            Promise.resolve(detector.buildFileStructure()),
            Promise.resolve(detector.analyzeLanguages()),
            Promise.resolve(detector.getDependencies()),
            Promise.resolve(detector.detectConventions()),
        ]);

        const now = new Date();
        const expiresAt = new Date(now.getTime() + CACHE_DURATION_MS);

        return {
            projectId,
            projectPath,
            frameworks,
            patterns,
            fileStructure,
            languages,
            dependencies,
            conventions,
            analyzedAt: now.toISOString(),
            expiresAt: expiresAt.toISOString(),
        };
    }

    /**
     * Get a summary of the analysis for PRD generation prompts
     */
    getSummaryForPrompt(analysis: CodebaseAnalysis): string {
        const parts: string[] = [];

        // Frameworks
        if (analysis.frameworks.length > 0) {
            const frameworkList = analysis.frameworks
                .filter(f => f.confidence >= 80)
                .map(f => f.version ? `${f.name} (${f.version})` : f.name)
                .join(', ');
            if (frameworkList) {
                parts.push(`**Frameworks:** ${frameworkList}`);
            }
        }

        // Languages
        const topLanguages = Object.entries(analysis.languages)
            .filter(([lang]) => !['JSON', 'Markdown', 'YAML'].includes(lang))
            .sort(([, a], [, b]) => b.percentage - a.percentage)
            .slice(0, 3)
            .map(([lang, stats]) => `${lang} (${stats.percentage}%)`)
            .join(', ');
        if (topLanguages) {
            parts.push(`**Languages:** ${topLanguages}`);
        }

        // Conventions
        const conventions = analysis.conventions;
        const conventionParts: string[] = [];
        if (conventions.typeSystem) conventionParts.push(conventions.typeSystem);
        if (conventions.moduleSystem) conventionParts.push(`${conventions.moduleSystem} modules`);
        if (conventions.testFramework) conventionParts.push(`${conventions.testFramework} tests`);
        if (conventions.stateManagement) conventionParts.push(`${conventions.stateManagement} state`);
        if (conventionParts.length > 0) {
            parts.push(`**Conventions:** ${conventionParts.join(', ')}`);
        }

        // Patterns found
        const patterns = analysis.patterns
            .filter(p => p.count > 0)
            .map(p => `${p.name} (${p.count} files)`)
            .join(', ');
        if (patterns) {
            parts.push(`**Patterns Found:** ${patterns}`);
        }

        // File structure overview
        const structure = analysis.fileStructure;
        if (structure.children && structure.children.length > 0) {
            const topDirs = structure.children
                .filter(c => c.type === 'directory')
                .slice(0, 6)
                .map(c => c.name)
                .join(', ');
            if (topDirs) {
                parts.push(`**Structure:** ${topDirs}`);
            }
        }

        return parts.join('\n');
    }

    /**
     * Find similar implementations in the codebase for a given concept
     */
    findSimilarImplementations(analysis: CodebaseAnalysis, concept: string): string[] {
        const conceptLower = concept.toLowerCase();
        const similar: string[] = [];

        // Search in pattern examples
        for (const pattern of analysis.patterns) {
            if (pattern.name.toLowerCase().includes(conceptLower) ||
                pattern.type.toLowerCase().includes(conceptLower)) {
                similar.push(...pattern.examples);
            }
        }

        // Search in file structure
        const searchTree = (node: typeof analysis.fileStructure): void => {
            if (node.name.toLowerCase().includes(conceptLower)) {
                similar.push(node.path);
            }
            if (node.children) {
                for (const child of node.children) {
                    searchTree(child);
                }
            }
        };
        searchTree(analysis.fileStructure);

        return [...new Set(similar)].slice(0, 10);
    }
}

// Singleton instance
let analyzerInstance: CodebaseAnalyzer | null = null;

export function getCodebaseAnalyzer(): CodebaseAnalyzer {
    if (!analyzerInstance) {
        analyzerInstance = new CodebaseAnalyzer();
    }
    return analyzerInstance;
}
