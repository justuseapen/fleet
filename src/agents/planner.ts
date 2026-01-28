import Anthropic from '@anthropic-ai/sdk';
import type { Agent, AgentContext, AgentResult } from './base.js';
import type { PrdJson, UserStory } from '../types.js';
import { calculateRiskScore, extractRiskFactors, getRiskBreakdown } from '../approval/risk.js';
import { insertPrd, generateId, updateTaskStatus, getTasksByProject, type Task, type Project } from '../db/index.js';
import { getCodebaseAnalyzer, DependencyMapper, type CodebaseAnalysis } from '../analysis/index.js';

const PRD_SYSTEM_PROMPT = `You are an expert software architect and product manager. Your job is to take a task or feature request and create a detailed Product Requirements Document (PRD) that can be executed by an autonomous coding agent.

The PRD must include:
1. A clear summary of the feature/task
2. Detailed acceptance criteria
3. Technical considerations (based on the codebase analysis provided)
4. User stories broken down into small, atomic units

CRITICAL: Each user story MUST be completable in a single context window by an AI agent. If a story is too large, break it down further.

For each user story, include:
- Clear title
- Description in "As a [user], I want [feature] so that [benefit]" format
- Specific acceptance criteria (always include "Typecheck passes")
- Priority (1 = highest)

IMPORTANT: Use the codebase context provided to:
- Follow existing patterns and conventions
- Reference specific files that need to be modified
- Ensure consistency with the existing architecture
- Mention prerequisite tasks if any are identified

Output the PRD in two parts:
1. The full PRD as markdown
2. A JSON block with the structure for ralph (prd.json format)`;

const PRD_USER_TEMPLATE = `Create a PRD for the following task:

Project: {projectName}
Mission: {mission}

Task Title: {taskTitle}
Task Description: {taskDescription}
Task Type: {taskType}
Labels: {labels}

## Codebase Context

{codebaseContext}

## Dependency Analysis

{dependencyContext}

---

Generate a comprehensive PRD with user stories that can be executed autonomously.
Use the codebase context to ensure the PRD follows existing patterns and references the correct files.

Return your response in this exact format:

## PRD Content

[Full PRD markdown here]

## prd.json

\`\`\`json
{
  "project": "{projectName}",
  "branchName": "fleet/{taskId}",
  "description": "[summary]",
  "userStories": [
    {
      "id": "US-001",
      "title": "[title]",
      "description": "[As a user...]",
      "acceptanceCriteria": ["criterion 1", "Typecheck passes"],
      "priority": 1,
      "passes": false,
      "notes": ""
    }
  ]
}
\`\`\``;

export class PlannerAgent implements Agent {
    name = 'planner';
    description = 'Generates PRDs from tasks using Claude with codebase analysis';

    private client: Anthropic;
    private analyzer = getCodebaseAnalyzer();

    constructor(apiKey?: string) {
        this.client = new Anthropic({
            apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
        });
    }

    async execute(context: AgentContext): Promise<AgentResult> {
        const { project, task } = context;

        if (!task) {
            return {
                success: false,
                error: 'No task provided to planner agent',
            };
        }

        try {
            // Analyze codebase for context
            let codebaseAnalysis: CodebaseAnalysis | null = null;
            try {
                codebaseAnalysis = await this.analyzer.analyze(project.id, project.path);
            } catch (error) {
                console.warn('Codebase analysis failed, continuing without context:', error);
            }

            // Generate PRD using Claude with enhanced context
            const { prdContent, prdJson } = await this.generatePrd(
                project,
                task,
                codebaseAnalysis
            );

            // Calculate risk score
            const riskFactors = extractRiskFactors(prdContent, prdJson, task.task_type);
            const riskScore = calculateRiskScore(riskFactors);
            const riskBreakdown = getRiskBreakdown(riskFactors);

            // Store PRD in database
            const prdId = generateId();
            insertPrd({
                id: prdId,
                task_id: task.id,
                proposal_id: null, // Task-based PRD, not proposal-based
                project_id: project.id,
                content: prdContent,
                prd_json: JSON.stringify(prdJson),
                risk_score: riskScore,
                risk_factors: JSON.stringify(riskBreakdown),
                status: 'pending',
                approved_at: null,
                approved_by: null,
            });

            // Update task status
            updateTaskStatus(task.id, 'planning');

            return {
                success: true,
                output: `Generated PRD with ${prdJson.userStories.length} user stories. Risk score: ${riskScore}`,
                artifacts: {
                    prdId,
                    riskScore,
                    storyCount: prdJson.userStories.length,
                    hasCodebaseContext: !!codebaseAnalysis,
                },
            };
        } catch (error) {
            return {
                success: false,
                error: `Failed to generate PRD: ${error}`,
            };
        }
    }

    private async generatePrd(
        project: Project,
        task: Task,
        analysis: CodebaseAnalysis | null
    ): Promise<{ prdContent: string; prdJson: PrdJson }> {
        // Get codebase context summary
        const codebaseContext = analysis
            ? this.analyzer.getSummaryForPrompt(analysis)
            : 'No codebase analysis available.';

        // Analyze dependencies
        let dependencyContext = 'No dependency analysis available.';
        if (analysis) {
            try {
                const dependencyMapper = new DependencyMapper(project.path);

                // Get other tasks for dependency detection
                const otherTasks = getTasksByProject(project.id)
                    .filter(t => t.id !== task.id && t.status === 'backlog')
                    .map(t => ({ id: t.id, title: t.title, description: t.description || '' }));

                const depAnalysis = await dependencyMapper.analyzeForTask(
                    task.title,
                    task.description || '',
                    analysis,
                    otherTasks
                );

                dependencyContext = dependencyMapper.formatForPrompt(depAnalysis);
            } catch (error) {
                console.warn('Dependency analysis failed:', error);
            }
        }

        const prompt = PRD_USER_TEMPLATE
            .replace(/{projectName}/g, project.name)
            .replace(/{mission}/g, project.mission || 'Not specified')
            .replace(/{taskTitle}/g, task.title)
            .replace(/{taskDescription}/g, task.description || 'No description provided')
            .replace(/{taskType}/g, task.task_type)
            .replace(/{taskId}/g, task.external_id)
            .replace(/{labels}/g, task.labels ? JSON.parse(task.labels).join(', ') : 'None')
            .replace(/{codebaseContext}/g, codebaseContext)
            .replace(/{dependencyContext}/g, dependencyContext);

        const message = await this.client.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 4096,
            system: PRD_SYSTEM_PROMPT,
            messages: [{ role: 'user', content: prompt }],
        });

        const responseText = message.content
            .filter(block => block.type === 'text')
            .map(block => (block as { type: 'text'; text: string }).text)
            .join('\n');

        // Parse PRD content and JSON
        const prdContent = this.extractPrdContent(responseText);
        const prdJson = this.extractPrdJson(responseText, project.name, task.external_id);

        return { prdContent, prdJson };
    }

    private extractPrdContent(response: string): string {
        // Extract everything between "## PRD Content" and "## prd.json"
        const prdMatch = response.match(/## PRD Content\s*([\s\S]*?)(?=## prd\.json|```json)/i);
        if (prdMatch) {
            return prdMatch[1].trim();
        }

        // Fallback: return everything before the JSON block
        const jsonIndex = response.indexOf('```json');
        if (jsonIndex > 0) {
            return response.substring(0, jsonIndex).trim();
        }

        return response;
    }

    private extractPrdJson(response: string, projectName: string, taskId: string): PrdJson {
        // Extract JSON from code block
        const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
        if (jsonMatch) {
            try {
                return JSON.parse(jsonMatch[1]) as PrdJson;
            } catch {
                // Fall through to default
            }
        }

        // Return default structure if parsing fails
        return {
            project: projectName,
            branchName: `fleet/${taskId}`,
            description: 'Auto-generated PRD',
            userStories: [
                {
                    id: 'US-001',
                    title: 'Implement task',
                    description: 'Complete the requested task',
                    acceptanceCriteria: ['Implementation complete', 'Typecheck passes'],
                    priority: 1,
                    passes: false,
                    notes: '',
                },
            ],
        };
    }
}
