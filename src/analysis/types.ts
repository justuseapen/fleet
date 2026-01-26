/**
 * Codebase Analysis Types
 * Types for analyzing project codebases to inform PRD generation
 */

export interface FrameworkInfo {
    name: string; // 'React', 'Vue', 'Express', 'Fastify', etc.
    version?: string;
    detectedVia: 'package.json' | 'imports' | 'config_file';
    confidence: number; // 0-100
}

export interface PatternDetection {
    name: string;
    type: 'component' | 'service' | 'hook' | 'utility' | 'handler' | 'model' | 'controller' | 'middleware' | 'test';
    examples: string[]; // File paths
    description?: string;
    count: number;
}

export interface FileNode {
    name: string;
    path: string;
    type: 'file' | 'directory';
    children?: FileNode[];
    extension?: string;
}

export interface LanguageStats {
    [language: string]: {
        fileCount: number;
        percentage: number;
    };
}

export interface DependencyInfo {
    name: string;
    version: string;
    type: 'production' | 'development';
}

export interface CodebaseAnalysis {
    projectId: string;
    projectPath: string;
    frameworks: FrameworkInfo[];
    patterns: PatternDetection[];
    fileStructure: FileNode;
    languages: LanguageStats;
    dependencies: DependencyInfo[];
    conventions: CodeConventions;
    analyzedAt: string;
    expiresAt: string;
}

export interface CodeConventions {
    testFramework?: string; // 'jest', 'vitest', 'mocha'
    styleGuide?: string; // 'eslint', 'prettier'
    moduleSystem?: 'esm' | 'cjs' | 'mixed';
    typeSystem?: 'typescript' | 'jsdoc' | 'none';
    componentStyle?: 'functional' | 'class' | 'mixed'; // For React
    stateManagement?: string; // 'redux', 'zustand', 'context'
}

export interface AnalysisCacheEntry {
    id: string;
    project_id: string;
    analysis_data: string; // JSON-stringified CodebaseAnalysis
    analyzed_at: string;
    expires_at: string;
}

// Framework detection patterns
export interface FrameworkPattern {
    name: string;
    packageIndicators: string[]; // Dependencies that indicate this framework
    fileIndicators: string[]; // Config files that indicate this framework
    importPatterns: RegExp[]; // Import statements that indicate usage
}

export const FRAMEWORK_PATTERNS: FrameworkPattern[] = [
    {
        name: 'React',
        packageIndicators: ['react', 'react-dom'],
        fileIndicators: [],
        importPatterns: [/from ['"]react['"]/, /import React/],
    },
    {
        name: 'Next.js',
        packageIndicators: ['next'],
        fileIndicators: ['next.config.js', 'next.config.mjs', 'next.config.ts'],
        importPatterns: [/from ['"]next\//],
    },
    {
        name: 'Vue',
        packageIndicators: ['vue'],
        fileIndicators: ['vue.config.js', 'vite.config.ts'],
        importPatterns: [/from ['"]vue['"]/, /\.vue['"]/],
    },
    {
        name: 'Nuxt',
        packageIndicators: ['nuxt'],
        fileIndicators: ['nuxt.config.js', 'nuxt.config.ts'],
        importPatterns: [/from ['"]#app['"]/],
    },
    {
        name: 'Express',
        packageIndicators: ['express'],
        fileIndicators: [],
        importPatterns: [/from ['"]express['"]/, /require\(['"]express['"]\)/],
    },
    {
        name: 'Fastify',
        packageIndicators: ['fastify'],
        fileIndicators: [],
        importPatterns: [/from ['"]fastify['"]/, /require\(['"]fastify['"]\)/],
    },
    {
        name: 'NestJS',
        packageIndicators: ['@nestjs/core', '@nestjs/common'],
        fileIndicators: ['nest-cli.json'],
        importPatterns: [/from ['"]@nestjs\//],
    },
    {
        name: 'Angular',
        packageIndicators: ['@angular/core'],
        fileIndicators: ['angular.json'],
        importPatterns: [/from ['"]@angular\//],
    },
    {
        name: 'Svelte',
        packageIndicators: ['svelte'],
        fileIndicators: ['svelte.config.js'],
        importPatterns: [/from ['"]svelte['"]/, /\.svelte['"]/],
    },
    {
        name: 'Tailwind CSS',
        packageIndicators: ['tailwindcss'],
        fileIndicators: ['tailwind.config.js', 'tailwind.config.ts'],
        importPatterns: [],
    },
    {
        name: 'Prisma',
        packageIndicators: ['prisma', '@prisma/client'],
        fileIndicators: ['prisma/schema.prisma'],
        importPatterns: [/from ['"]@prisma\/client['"]/],
    },
    {
        name: 'Drizzle',
        packageIndicators: ['drizzle-orm'],
        fileIndicators: ['drizzle.config.ts'],
        importPatterns: [/from ['"]drizzle-orm['"]/],
    },
];

// Directory patterns for detecting project structure
export interface DirectoryPattern {
    type: PatternDetection['type'];
    patterns: string[]; // Directory names that indicate this type
}

export const DIRECTORY_PATTERNS: DirectoryPattern[] = [
    { type: 'component', patterns: ['components', 'ui', 'views'] },
    { type: 'service', patterns: ['services', 'api', 'lib'] },
    { type: 'hook', patterns: ['hooks', 'composables'] },
    { type: 'utility', patterns: ['utils', 'helpers', 'lib'] },
    { type: 'handler', patterns: ['handlers', 'controllers', 'routes', 'app/api'] },
    { type: 'model', patterns: ['models', 'entities', 'schemas'] },
    { type: 'middleware', patterns: ['middleware', 'middlewares'] },
    { type: 'test', patterns: ['__tests__', 'tests', 'test', 'spec'] },
];
