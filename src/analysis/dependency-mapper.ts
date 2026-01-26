/**
 * Dependency Mapper
 * Maps file dependencies and identifies files likely to be modified for a task
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, extname, relative, dirname } from 'path';
import type { CodebaseAnalysis, PatternDetection } from './types.js';

// Keywords that indicate certain file types should be modified
const FILE_MODIFICATION_KEYWORDS: Record<string, string[]> = {
    component: ['ui', 'component', 'button', 'form', 'modal', 'dialog', 'card', 'list', 'table', 'nav', 'header', 'footer', 'sidebar'],
    api: ['api', 'endpoint', 'route', 'handler', 'controller', 'rest', 'graphql', 'server action'],
    database: ['database', 'migration', 'schema', 'model', 'entity', 'prisma', 'drizzle', 'sql', 'table'],
    auth: ['auth', 'login', 'logout', 'session', 'jwt', 'oauth', 'permission', 'role'],
    test: ['test', 'spec', 'coverage', 'mock'],
    style: ['style', 'css', 'theme', 'color', 'layout', 'responsive'],
    config: ['config', 'setting', 'env', 'environment'],
    util: ['util', 'helper', 'hook', 'service'],
};

// Directories to skip when scanning
const SKIP_DIRS = new Set([
    'node_modules', '.git', 'dist', 'build', '.next', '.nuxt',
    'coverage', '.cache', '__pycache__', 'venv', '.venv',
]);

export interface FileDependency {
    path: string;
    imports: string[];
    importedBy: string[];
}

export interface FileModificationSuggestion {
    path: string;
    reason: string;
    confidence: number; // 0-100
    type: 'create' | 'modify' | 'reference';
    snippet?: string;
}

export interface TaskDependency {
    taskId: string;
    taskTitle: string;
    dependencyType: 'blocks' | 'related' | 'similar';
    reason: string;
}

export interface DependencyAnalysis {
    suggestedFiles: FileModificationSuggestion[];
    taskDependencies: TaskDependency[];
    relevantSnippets: { path: string; content: string; reason: string }[];
}

export class DependencyMapper {
    private projectPath: string;
    private fileCache: Map<string, string> = new Map();
    private dependencyGraph: Map<string, FileDependency> = new Map();

    constructor(projectPath: string) {
        this.projectPath = projectPath;
    }

    /**
     * Analyze dependencies for a specific task
     */
    async analyzeForTask(
        taskTitle: string,
        taskDescription: string,
        analysis: CodebaseAnalysis,
        existingTasks?: { id: string; title: string; description: string }[]
    ): Promise<DependencyAnalysis> {
        const taskText = `${taskTitle} ${taskDescription}`.toLowerCase();

        // Find files that might need modification
        const suggestedFiles = this.findSuggestedFiles(taskText, analysis);

        // Find dependencies with other tasks
        const taskDependencies = existingTasks
            ? this.findTaskDependencies(taskText, existingTasks)
            : [];

        // Get relevant code snippets
        const relevantSnippets = this.getRelevantSnippets(suggestedFiles, taskText);

        return {
            suggestedFiles,
            taskDependencies,
            relevantSnippets,
        };
    }

    /**
     * Find files that might need modification based on task description
     */
    private findSuggestedFiles(
        taskText: string,
        analysis: CodebaseAnalysis
    ): FileModificationSuggestion[] {
        const suggestions: FileModificationSuggestion[] = [];
        const addedPaths = new Set<string>();

        // Determine which file types are relevant
        const relevantTypes = this.getRelevantFileTypes(taskText);

        // Search through patterns to find existing implementations
        for (const pattern of analysis.patterns) {
            if (this.isPatternRelevant(pattern, relevantTypes, taskText)) {
                for (const example of pattern.examples) {
                    if (addedPaths.has(example)) continue;
                    addedPaths.add(example);

                    suggestions.push({
                        path: example,
                        reason: `Existing ${pattern.name} - similar pattern may need updates`,
                        confidence: 70,
                        type: 'modify',
                    });
                }
            }
        }

        // Search file structure for keyword matches
        const keywordMatches = this.searchFileStructure(analysis.fileStructure, taskText);
        for (const match of keywordMatches) {
            if (addedPaths.has(match.path)) continue;
            addedPaths.add(match.path);

            suggestions.push({
                path: match.path,
                reason: match.reason,
                confidence: match.confidence,
                type: 'modify',
            });
        }

        // Suggest new files if patterns indicate they should be created
        const newFileSuggestions = this.suggestNewFiles(taskText, analysis, relevantTypes);
        for (const suggestion of newFileSuggestions) {
            if (!addedPaths.has(suggestion.path)) {
                suggestions.push(suggestion);
            }
        }

        // Sort by confidence
        return suggestions.sort((a, b) => b.confidence - a.confidence).slice(0, 15);
    }

    /**
     * Get relevant file types based on task keywords
     */
    private getRelevantFileTypes(taskText: string): Set<string> {
        const relevantTypes = new Set<string>();

        for (const [type, keywords] of Object.entries(FILE_MODIFICATION_KEYWORDS)) {
            if (keywords.some(kw => taskText.includes(kw))) {
                relevantTypes.add(type);
            }
        }

        // Default to component and util if nothing specific found
        if (relevantTypes.size === 0) {
            relevantTypes.add('component');
            relevantTypes.add('util');
        }

        return relevantTypes;
    }

    /**
     * Check if a pattern is relevant to the task
     */
    private isPatternRelevant(
        pattern: PatternDetection,
        relevantTypes: Set<string>,
        taskText: string
    ): boolean {
        // Check pattern type
        const typeMapping: Record<string, string[]> = {
            component: ['component'],
            service: ['api', 'util'],
            hook: ['util', 'component'],
            utility: ['util'],
            handler: ['api'],
            model: ['database'],
            controller: ['api'],
            middleware: ['api', 'auth'],
            test: ['test'],
        };

        const mappedTypes = typeMapping[pattern.type] || [];
        if (mappedTypes.some(t => relevantTypes.has(t))) {
            return true;
        }

        // Check if pattern name is mentioned in task
        if (taskText.includes(pattern.name.toLowerCase())) {
            return true;
        }

        return false;
    }

    /**
     * Search file structure for keyword matches
     */
    private searchFileStructure(
        node: CodebaseAnalysis['fileStructure'],
        taskText: string,
        depth = 0
    ): { path: string; reason: string; confidence: number }[] {
        const matches: { path: string; reason: string; confidence: number }[] = [];

        if (depth > 5) return matches;

        const nameLower = node.name.toLowerCase();

        // Check if file/dir name contains task keywords
        const keywords = taskText.split(/\s+/).filter(w => w.length > 3);
        for (const keyword of keywords) {
            if (nameLower.includes(keyword)) {
                const confidence = node.type === 'file' ? 60 : 40;
                matches.push({
                    path: node.path,
                    reason: `Name contains keyword "${keyword}"`,
                    confidence,
                });
                break;
            }
        }

        // Recurse into children
        if (node.children) {
            for (const child of node.children) {
                matches.push(...this.searchFileStructure(child, taskText, depth + 1));
            }
        }

        return matches;
    }

    /**
     * Suggest new files that might need to be created
     */
    private suggestNewFiles(
        taskText: string,
        analysis: CodebaseAnalysis,
        relevantTypes: Set<string>
    ): FileModificationSuggestion[] {
        const suggestions: FileModificationSuggestion[] = [];

        // Find directories where new files should be created
        const componentDirs = analysis.patterns
            .filter(p => p.type === 'component')
            .flatMap(p => p.examples.map(e => dirname(e)));

        const serviceDirs = analysis.patterns
            .filter(p => p.type === 'service')
            .flatMap(p => p.examples.map(e => dirname(e)));

        // Extract potential new file names from task
        const potentialNames = this.extractPotentialFileNames(taskText);

        for (const name of potentialNames) {
            if (relevantTypes.has('component') && componentDirs.length > 0) {
                suggestions.push({
                    path: `${componentDirs[0]}/${name}.tsx`,
                    reason: `New component for ${name}`,
                    confidence: 50,
                    type: 'create',
                });
            }

            if (relevantTypes.has('api') && serviceDirs.length > 0) {
                suggestions.push({
                    path: `${serviceDirs[0]}/${name}.ts`,
                    reason: `New service for ${name}`,
                    confidence: 50,
                    type: 'create',
                });
            }
        }

        return suggestions;
    }

    /**
     * Extract potential file names from task description
     */
    private extractPotentialFileNames(taskText: string): string[] {
        const names: string[] = [];

        // Look for patterns like "add/create/implement X"
        const createPatterns = [
            /(?:add|create|implement|build)\s+(?:a\s+)?(\w+)/gi,
            /new\s+(\w+)/gi,
        ];

        for (const pattern of createPatterns) {
            let match;
            while ((match = pattern.exec(taskText)) !== null) {
                const name = match[1].toLowerCase();
                if (name.length > 2 && !['the', 'for', 'and', 'new'].includes(name)) {
                    names.push(name);
                }
            }
        }

        return [...new Set(names)];
    }

    /**
     * Find dependencies with other tasks in the backlog
     */
    private findTaskDependencies(
        taskText: string,
        existingTasks: { id: string; title: string; description: string }[]
    ): TaskDependency[] {
        const dependencies: TaskDependency[] = [];
        const taskKeywords = new Set(
            taskText.split(/\s+/).filter(w => w.length > 3)
        );

        for (const task of existingTasks) {
            const otherText = `${task.title} ${task.description}`.toLowerCase();
            const otherKeywords = new Set(
                otherText.split(/\s+/).filter(w => w.length > 3)
            );

            // Check for keyword overlap
            const overlap = [...taskKeywords].filter(k => otherKeywords.has(k));

            if (overlap.length >= 2) {
                // Determine dependency type
                const type = this.determineDependencyType(taskText, otherText);

                dependencies.push({
                    taskId: task.id,
                    taskTitle: task.title,
                    dependencyType: type,
                    reason: `Shared concepts: ${overlap.slice(0, 3).join(', ')}`,
                });
            }
        }

        return dependencies;
    }

    /**
     * Determine the type of dependency between tasks
     */
    private determineDependencyType(
        taskText: string,
        otherText: string
    ): 'blocks' | 'related' | 'similar' {
        // Check for blocking patterns
        const blockingPatterns = [
            /database|schema|migration|model/,
            /setup|initialize|configure/,
            /api|endpoint|backend/,
        ];

        const currentHasBackend = blockingPatterns.some(p => p.test(taskText));
        const otherHasBackend = blockingPatterns.some(p => p.test(otherText));

        if (otherHasBackend && !currentHasBackend) {
            return 'blocks';
        }

        // Check for similar patterns
        const similarityThreshold = 0.5;
        const similarity = this.calculateSimilarity(taskText, otherText);

        if (similarity > similarityThreshold) {
            return 'similar';
        }

        return 'related';
    }

    /**
     * Calculate text similarity using Jaccard index
     */
    private calculateSimilarity(text1: string, text2: string): number {
        const words1 = new Set(text1.split(/\s+/).filter(w => w.length > 3));
        const words2 = new Set(text2.split(/\s+/).filter(w => w.length > 3));

        const intersection = [...words1].filter(w => words2.has(w)).length;
        const union = new Set([...words1, ...words2]).size;

        return union > 0 ? intersection / union : 0;
    }

    /**
     * Get relevant code snippets from suggested files
     */
    private getRelevantSnippets(
        suggestions: FileModificationSuggestion[],
        taskText: string
    ): { path: string; content: string; reason: string }[] {
        const snippets: { path: string; content: string; reason: string }[] = [];

        // Only get snippets from files to modify (not create)
        const filesToRead = suggestions
            .filter(s => s.type === 'modify' && s.confidence >= 60)
            .slice(0, 5);

        for (const suggestion of filesToRead) {
            const fullPath = join(this.projectPath, suggestion.path);
            if (!existsSync(fullPath)) continue;

            try {
                const content = readFileSync(fullPath, 'utf-8');

                // Extract relevant portion (first 50 lines or specific section)
                const lines = content.split('\n');
                const relevantLines = this.extractRelevantLines(lines, taskText);

                if (relevantLines.length > 0) {
                    snippets.push({
                        path: suggestion.path,
                        content: relevantLines.join('\n'),
                        reason: suggestion.reason,
                    });
                }
            } catch {
                // Skip files that can't be read
            }
        }

        return snippets;
    }

    /**
     * Extract relevant lines from a file based on task keywords
     */
    private extractRelevantLines(lines: string[], taskText: string): string[] {
        const keywords = taskText.split(/\s+/).filter(w => w.length > 3);
        const relevantIndices = new Set<number>();

        // Find lines containing keywords
        for (let i = 0; i < lines.length; i++) {
            const lineLower = lines[i].toLowerCase();
            if (keywords.some(k => lineLower.includes(k))) {
                // Include context: 2 lines before and after
                for (let j = Math.max(0, i - 2); j <= Math.min(lines.length - 1, i + 2); j++) {
                    relevantIndices.add(j);
                }
            }
        }

        // If no keyword matches, return first 30 lines
        if (relevantIndices.size === 0) {
            return lines.slice(0, 30);
        }

        // Get consecutive ranges
        const sortedIndices = [...relevantIndices].sort((a, b) => a - b);
        const result: string[] = [];
        let lastIndex = -2;

        for (const index of sortedIndices) {
            if (index > lastIndex + 1 && result.length > 0) {
                result.push('// ...');
            }
            result.push(lines[index]);
            lastIndex = index;

            // Limit total lines
            if (result.length >= 40) break;
        }

        return result;
    }

    /**
     * Format dependency analysis for PRD prompt
     */
    formatForPrompt(analysis: DependencyAnalysis): string {
        const parts: string[] = [];

        // Suggested files
        if (analysis.suggestedFiles.length > 0) {
            parts.push('**Files Likely to Need Changes:**');
            const filesByType = {
                modify: analysis.suggestedFiles.filter(f => f.type === 'modify'),
                create: analysis.suggestedFiles.filter(f => f.type === 'create'),
            };

            if (filesByType.modify.length > 0) {
                parts.push('  _Existing files to modify:_');
                for (const f of filesByType.modify.slice(0, 8)) {
                    parts.push(`  - \`${f.path}\` - ${f.reason}`);
                }
            }

            if (filesByType.create.length > 0) {
                parts.push('  _New files to create:_');
                for (const f of filesByType.create.slice(0, 4)) {
                    parts.push(`  - \`${f.path}\` - ${f.reason}`);
                }
            }
        }

        // Task dependencies
        if (analysis.taskDependencies.length > 0) {
            parts.push('\n**Related/Prerequisite Tasks:**');
            for (const dep of analysis.taskDependencies) {
                const label = dep.dependencyType === 'blocks' ? '⚠️ PREREQUISITE' :
                    dep.dependencyType === 'similar' ? '📋 Similar' : '🔗 Related';
                parts.push(`  ${label}: ${dep.taskTitle} - ${dep.reason}`);
            }
        }

        // Relevant snippets
        if (analysis.relevantSnippets.length > 0) {
            parts.push('\n**Relevant Code Examples:**');
            for (const snippet of analysis.relevantSnippets.slice(0, 3)) {
                parts.push(`\n_${snippet.path}:_`);
                parts.push('```');
                parts.push(snippet.content.slice(0, 500));
                parts.push('```');
            }
        }

        return parts.join('\n');
    }
}
