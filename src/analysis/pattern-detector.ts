/**
 * Pattern Detector
 * Detects frameworks, coding patterns, and conventions from a codebase
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, extname, basename, relative } from 'path';
import type {
    FrameworkInfo,
    PatternDetection,
    FileNode,
    LanguageStats,
    DependencyInfo,
    CodeConventions,
    FrameworkPattern,
} from './types.js';
import { FRAMEWORK_PATTERNS, DIRECTORY_PATTERNS } from './types.js';

// Directories to ignore during scanning
const IGNORED_DIRS = new Set([
    'node_modules',
    '.git',
    'dist',
    'build',
    '.next',
    '.nuxt',
    'coverage',
    '.cache',
    '__pycache__',
    'venv',
    '.venv',
    'vendor',
    'target',
]);

// File extensions to language mapping
const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
    '.ts': 'TypeScript',
    '.tsx': 'TypeScript',
    '.js': 'JavaScript',
    '.jsx': 'JavaScript',
    '.py': 'Python',
    '.rb': 'Ruby',
    '.go': 'Go',
    '.rs': 'Rust',
    '.java': 'Java',
    '.kt': 'Kotlin',
    '.swift': 'Swift',
    '.css': 'CSS',
    '.scss': 'SCSS',
    '.less': 'LESS',
    '.vue': 'Vue',
    '.svelte': 'Svelte',
    '.sql': 'SQL',
    '.md': 'Markdown',
    '.json': 'JSON',
    '.yaml': 'YAML',
    '.yml': 'YAML',
};

export class PatternDetector {
    private projectPath: string;
    private packageJson: Record<string, unknown> | null = null;

    constructor(projectPath: string) {
        this.projectPath = projectPath;
        this.loadPackageJson();
    }

    private loadPackageJson(): void {
        const packagePath = join(this.projectPath, 'package.json');
        if (existsSync(packagePath)) {
            try {
                this.packageJson = JSON.parse(readFileSync(packagePath, 'utf-8'));
            } catch {
                this.packageJson = null;
            }
        }
    }

    /**
     * Detect frameworks used in the project
     */
    detectFrameworks(): FrameworkInfo[] {
        const frameworks: FrameworkInfo[] = [];
        const allDependencies = this.getAllDependencies();

        for (const pattern of FRAMEWORK_PATTERNS) {
            const detection = this.detectFramework(pattern, allDependencies);
            if (detection) {
                frameworks.push(detection);
            }
        }

        return frameworks.sort((a, b) => b.confidence - a.confidence);
    }

    private detectFramework(
        pattern: FrameworkPattern,
        dependencies: Map<string, string>
    ): FrameworkInfo | null {
        let confidence = 0;
        let detectedVia: FrameworkInfo['detectedVia'] = 'package.json';
        let version: string | undefined;

        // Check package.json dependencies (highest confidence)
        for (const indicator of pattern.packageIndicators) {
            if (dependencies.has(indicator)) {
                confidence = Math.max(confidence, 90);
                version = dependencies.get(indicator);
                detectedVia = 'package.json';
            }
        }

        // Check for config files
        for (const configFile of pattern.fileIndicators) {
            if (existsSync(join(this.projectPath, configFile))) {
                confidence = Math.max(confidence, 95);
                detectedVia = 'config_file';
            }
        }

        // Only return if we have reasonable confidence
        if (confidence > 0) {
            return {
                name: pattern.name,
                version,
                detectedVia,
                confidence,
            };
        }

        return null;
    }

    private getAllDependencies(): Map<string, string> {
        const deps = new Map<string, string>();
        if (!this.packageJson) return deps;

        const depTypes = ['dependencies', 'devDependencies', 'peerDependencies'];
        for (const depType of depTypes) {
            const typedDeps = (this.packageJson as Record<string, Record<string, string>>)[depType];
            if (typedDeps && typeof typedDeps === 'object') {
                for (const [name, version] of Object.entries(typedDeps)) {
                    deps.set(name, version);
                }
            }
        }

        return deps;
    }

    /**
     * Get production and dev dependencies
     */
    getDependencies(): DependencyInfo[] {
        const deps: DependencyInfo[] = [];
        if (!this.packageJson) return deps;

        const prodDeps = (this.packageJson as Record<string, Record<string, string>>).dependencies || {};
        const devDeps = (this.packageJson as Record<string, Record<string, string>>).devDependencies || {};

        for (const [name, version] of Object.entries(prodDeps)) {
            deps.push({ name, version, type: 'production' });
        }
        for (const [name, version] of Object.entries(devDeps)) {
            deps.push({ name, version, type: 'development' });
        }

        return deps;
    }

    /**
     * Detect coding patterns in the project structure
     */
    detectPatterns(): PatternDetection[] {
        const patterns: PatternDetection[] = [];

        for (const dirPattern of DIRECTORY_PATTERNS) {
            for (const patternName of dirPattern.patterns) {
                const detection = this.findPatternInstances(patternName, dirPattern.type);
                if (detection && detection.count > 0) {
                    // Check if we already have this pattern type
                    const existing = patterns.find(p => p.type === detection.type);
                    if (existing) {
                        existing.examples.push(...detection.examples);
                        existing.count += detection.count;
                    } else {
                        patterns.push(detection);
                    }
                }
            }
        }

        // Deduplicate examples
        for (const pattern of patterns) {
            pattern.examples = [...new Set(pattern.examples)].slice(0, 5); // Keep top 5 examples
        }

        return patterns;
    }

    private findPatternInstances(
        dirName: string,
        type: PatternDetection['type']
    ): PatternDetection | null {
        const examples: string[] = [];
        let count = 0;

        const searchDir = (dir: string): void => {
            if (!existsSync(dir)) return;

            try {
                const entries = readdirSync(dir, { withFileTypes: true });
                for (const entry of entries) {
                    if (IGNORED_DIRS.has(entry.name)) continue;

                    const fullPath = join(dir, entry.name);
                    const relativePath = relative(this.projectPath, fullPath);

                    if (entry.isDirectory()) {
                        if (entry.name.toLowerCase() === dirName.toLowerCase() ||
                            entry.name.toLowerCase().includes(dirName.toLowerCase())) {
                            // Found a matching directory, count files inside
                            const files = this.getFilesInDir(fullPath);
                            count += files.length;
                            examples.push(...files.slice(0, 3).map(f => relative(this.projectPath, f)));
                        }
                        // Continue searching subdirectories (but not too deep)
                        if (relativePath.split('/').length < 4) {
                            searchDir(fullPath);
                        }
                    }
                }
            } catch {
                // Ignore permission errors
            }
        };

        searchDir(this.projectPath);

        if (count === 0) return null;

        return {
            name: this.getPatternDisplayName(type),
            type,
            examples,
            count,
            description: this.getPatternDescription(type),
        };
    }

    private getFilesInDir(dir: string): string[] {
        const files: string[] = [];

        const scan = (d: string): void => {
            try {
                const entries = readdirSync(d, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.name.startsWith('.')) continue;
                    const fullPath = join(d, entry.name);
                    if (entry.isFile()) {
                        const ext = extname(entry.name);
                        if (EXTENSION_LANGUAGE_MAP[ext]) {
                            files.push(fullPath);
                        }
                    } else if (entry.isDirectory() && !IGNORED_DIRS.has(entry.name)) {
                        scan(fullPath);
                    }
                }
            } catch {
                // Ignore errors
            }
        };

        scan(dir);
        return files;
    }

    private getPatternDisplayName(type: PatternDetection['type']): string {
        const names: Record<PatternDetection['type'], string> = {
            component: 'UI Components',
            service: 'Services',
            hook: 'Hooks/Composables',
            utility: 'Utilities',
            handler: 'Route Handlers',
            model: 'Data Models',
            controller: 'Controllers',
            middleware: 'Middleware',
            test: 'Tests',
        };
        return names[type];
    }

    private getPatternDescription(type: PatternDetection['type']): string {
        const descriptions: Record<PatternDetection['type'], string> = {
            component: 'Reusable UI components',
            service: 'Business logic and API services',
            hook: 'State and side-effect management',
            utility: 'Helper functions and utilities',
            handler: 'API route handlers',
            model: 'Data models and schemas',
            controller: 'Request controllers',
            middleware: 'Request/response middleware',
            test: 'Test files and specs',
        };
        return descriptions[type];
    }

    /**
     * Build file structure tree (limited depth)
     */
    buildFileStructure(maxDepth = 3): FileNode {
        const buildNode = (dir: string, depth: number): FileNode => {
            const name = basename(dir) || dir;
            const node: FileNode = {
                name,
                path: relative(this.projectPath, dir) || '.',
                type: 'directory',
                children: [],
            };

            if (depth >= maxDepth) return node;

            try {
                const entries = readdirSync(dir, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
                    if (IGNORED_DIRS.has(entry.name)) continue;

                    const fullPath = join(dir, entry.name);

                    if (entry.isDirectory()) {
                        node.children!.push(buildNode(fullPath, depth + 1));
                    } else {
                        node.children!.push({
                            name: entry.name,
                            path: relative(this.projectPath, fullPath),
                            type: 'file',
                            extension: extname(entry.name),
                        });
                    }
                }

                // Sort: directories first, then files, alphabetically
                node.children!.sort((a, b) => {
                    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
                    return a.name.localeCompare(b.name);
                });
            } catch {
                // Ignore permission errors
            }

            return node;
        };

        return buildNode(this.projectPath, 0);
    }

    /**
     * Analyze language distribution
     */
    analyzeLanguages(): LanguageStats {
        const stats: Record<string, number> = {};
        let totalFiles = 0;

        const scan = (dir: string): void => {
            try {
                const entries = readdirSync(dir, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.name.startsWith('.')) continue;
                    if (IGNORED_DIRS.has(entry.name)) continue;

                    const fullPath = join(dir, entry.name);

                    if (entry.isDirectory()) {
                        scan(fullPath);
                    } else {
                        const ext = extname(entry.name);
                        const lang = EXTENSION_LANGUAGE_MAP[ext];
                        if (lang) {
                            stats[lang] = (stats[lang] || 0) + 1;
                            totalFiles++;
                        }
                    }
                }
            } catch {
                // Ignore errors
            }
        };

        scan(this.projectPath);

        const result: LanguageStats = {};
        for (const [lang, count] of Object.entries(stats)) {
            result[lang] = {
                fileCount: count,
                percentage: totalFiles > 0 ? Math.round((count / totalFiles) * 100) : 0,
            };
        }

        return result;
    }

    /**
     * Detect coding conventions
     */
    detectConventions(): CodeConventions {
        const conventions: CodeConventions = {};
        const deps = this.getAllDependencies();

        // Test framework
        if (deps.has('vitest')) conventions.testFramework = 'vitest';
        else if (deps.has('jest')) conventions.testFramework = 'jest';
        else if (deps.has('mocha')) conventions.testFramework = 'mocha';

        // Style guide
        if (deps.has('eslint')) conventions.styleGuide = 'eslint';
        if (deps.has('prettier')) {
            conventions.styleGuide = conventions.styleGuide
                ? `${conventions.styleGuide}+prettier`
                : 'prettier';
        }

        // Module system
        if (this.packageJson) {
            const type = (this.packageJson as Record<string, string>).type;
            conventions.moduleSystem = type === 'module' ? 'esm' : 'cjs';
        }

        // Type system
        if (deps.has('typescript') || existsSync(join(this.projectPath, 'tsconfig.json'))) {
            conventions.typeSystem = 'typescript';
        }

        // State management (React)
        if (deps.has('redux') || deps.has('@reduxjs/toolkit')) {
            conventions.stateManagement = 'redux';
        } else if (deps.has('zustand')) {
            conventions.stateManagement = 'zustand';
        } else if (deps.has('jotai')) {
            conventions.stateManagement = 'jotai';
        } else if (deps.has('recoil')) {
            conventions.stateManagement = 'recoil';
        }

        return conventions;
    }
}
