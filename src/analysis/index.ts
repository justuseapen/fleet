/**
 * Analysis Module
 * Exports for codebase analysis functionality
 */

export { CodebaseAnalyzer, getCodebaseAnalyzer } from './codebase-analyzer.js';
export { PatternDetector } from './pattern-detector.js';
export { DependencyMapper } from './dependency-mapper.js';
export type {
    CodebaseAnalysis,
    FrameworkInfo,
    PatternDetection,
    FileNode,
    LanguageStats,
    DependencyInfo,
    CodeConventions,
    AnalysisCacheEntry,
} from './types.js';
export type {
    FileDependency,
    FileModificationSuggestion,
    TaskDependency,
    DependencyAnalysis,
} from './dependency-mapper.js';
