/**
 * Analyze Command
 * Analyzes project codebase to detect frameworks, patterns, and conventions
 */

import { Command } from 'commander';
import { getProjectByPath, getAllProjects, type Project } from '../../db/index.js';
import { getCodebaseAnalyzer } from '../../analysis/index.js';

export const analyzeCommand = new Command('analyze')
    .description('Analyze project codebase to detect frameworks, patterns, and conventions')
    .option('-p, --project <name>', 'Analyze a specific project by name')
    .option('-r, --refresh', 'Force refresh analysis (ignore cache)', false)
    .option('--json', 'Output as JSON', false)
    .action(async (options) => {
        const analyzer = getCodebaseAnalyzer();

        let project: Project | undefined;

        if (options.project) {
            // Find project by name
            const projects = getAllProjects();
            project = projects.find(p => p.name.toLowerCase() === options.project.toLowerCase());
            if (!project) {
                console.error(`Project not found: ${options.project}`);
                process.exit(1);
            }
        } else {
            // Use current directory
            const cwd = process.cwd();
            project = getProjectByPath(cwd);
            if (!project) {
                console.error('No Fleet project found in current directory.');
                console.error('Run "fleet projects add" to register this project, or use --project flag.');
                process.exit(1);
            }
        }

        try {
            console.log(`Analyzing ${project.name}...`);
            const startTime = Date.now();

            const analysis = await analyzer.analyze(project.id, project.path, options.refresh);

            const duration = ((Date.now() - startTime) / 1000).toFixed(2);

            if (options.json) {
                console.log(JSON.stringify(analysis, null, 2));
                return;
            }

            // Pretty print analysis
            console.log('\n📊 Codebase Analysis\n');
            console.log(`Project: ${project.name}`);
            console.log(`Path: ${project.path}`);
            console.log(`Analyzed: ${analysis.analyzedAt}`);
            console.log(`Duration: ${duration}s\n`);

            // Frameworks
            if (analysis.frameworks.length > 0) {
                console.log('🔧 Frameworks Detected:');
                for (const fw of analysis.frameworks) {
                    const version = fw.version ? ` (${fw.version})` : '';
                    const confidence = fw.confidence >= 90 ? '✓' : '~';
                    console.log(`   ${confidence} ${fw.name}${version} - via ${fw.detectedVia}`);
                }
                console.log();
            }

            // Languages
            const languageEntries = Object.entries(analysis.languages)
                .filter(([lang]) => !['JSON', 'Markdown', 'YAML'].includes(lang))
                .sort(([, a], [, b]) => b.percentage - a.percentage);

            if (languageEntries.length > 0) {
                console.log('📝 Language Distribution:');
                for (const [lang, stats] of languageEntries.slice(0, 5)) {
                    const bar = '█'.repeat(Math.floor(stats.percentage / 5));
                    console.log(`   ${lang.padEnd(12)} ${bar.padEnd(20)} ${stats.percentage}% (${stats.fileCount} files)`);
                }
                console.log();
            }

            // Conventions
            const conv = analysis.conventions;
            const convParts: string[] = [];
            if (conv.typeSystem) convParts.push(`Type System: ${conv.typeSystem}`);
            if (conv.moduleSystem) convParts.push(`Modules: ${conv.moduleSystem.toUpperCase()}`);
            if (conv.testFramework) convParts.push(`Testing: ${conv.testFramework}`);
            if (conv.styleGuide) convParts.push(`Style: ${conv.styleGuide}`);
            if (conv.stateManagement) convParts.push(`State: ${conv.stateManagement}`);

            if (convParts.length > 0) {
                console.log('⚙️  Conventions:');
                for (const part of convParts) {
                    console.log(`   • ${part}`);
                }
                console.log();
            }

            // Patterns
            if (analysis.patterns.length > 0) {
                console.log('📁 Code Patterns:');
                for (const pattern of analysis.patterns) {
                    console.log(`   ${pattern.name}: ${pattern.count} files`);
                    for (const example of pattern.examples.slice(0, 2)) {
                        console.log(`      └─ ${example}`);
                    }
                }
                console.log();
            }

            // File structure (top level)
            if (analysis.fileStructure.children) {
                const dirs = analysis.fileStructure.children
                    .filter(c => c.type === 'directory')
                    .map(c => c.name);
                const files = analysis.fileStructure.children
                    .filter(c => c.type === 'file')
                    .map(c => c.name);

                console.log('📂 Project Structure:');
                console.log(`   Directories: ${dirs.slice(0, 8).join(', ')}${dirs.length > 8 ? '...' : ''}`);
                console.log(`   Root Files: ${files.slice(0, 5).join(', ')}${files.length > 5 ? '...' : ''}`);
                console.log();
            }

            // Summary for PRD generation
            console.log('📋 PRD Context Summary:');
            console.log(analyzer.getSummaryForPrompt(analysis).split('\n').map(l => `   ${l}`).join('\n'));
            console.log();

        } catch (error) {
            console.error(`Analysis failed: ${error}`);
            process.exit(1);
        }
    });
