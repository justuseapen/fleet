import Anthropic from '@anthropic-ai/sdk';
import type { Agent, AgentContext, AgentResult } from './base.js';
import type { PrdJson, UserStory } from '../types.js';
import { calculateRiskScore, extractRiskFactors, getRiskBreakdown } from '../approval/risk.js';
import { insertPrd, generateId, updateTaskStatus, type Task } from '../db/index.js';

const PRD_SYSTEM_PROMPT = `You are an expert software architect and product manager. Your job is to take a task or feature request and create a detailed Product Requirements Document (PRD) that can be executed by an autonomous coding agent.

The PRD must include:
1. A clear summary of the feature/task
2. Detailed acceptance criteria
3. Technical considerations
4. User stories broken down into small, atomic units

CRITICAL: Each user story MUST be completable in a single context window by an AI agent. If a story is too large, break it down further.

For each user story, include:
- Clear title
- Description in "As a [user], I want [feature] so that [benefit]" format
- Specific acceptance criteria (always include "Typecheck passes")
- Priority (1 = highest)

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

Generate a comprehensive PRD with user stories that can be executed autonomously.

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
    description = 'Generates PRDs from tasks using Claude';

    private client: Anthropic;

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
            // Generate PRD using Claude
            const { prdContent, prdJson } = await this.generatePrd(project, task);

            // Calculate risk score
            const riskFactors = extractRiskFactors(prdContent, prdJson, task.task_type);
            const riskScore = calculateRiskScore(riskFactors);
            const riskBreakdown = getRiskBreakdown(riskFactors);

            // Store PRD in database
            const prdId = generateId();
            insertPrd({
                id: prdId,
                task_id: task.id,
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
        project: { name: string; mission: string | null },
        task: Task
    ): Promise<{ prdContent: string; prdJson: PrdJson }> {
        const prompt = PRD_USER_TEMPLATE
            .replace(/{projectName}/g, project.name)
            .replace(/{mission}/g, project.mission || 'Not specified')
            .replace(/{taskTitle}/g, task.title)
            .replace(/{taskDescription}/g, task.description || 'No description provided')
            .replace(/{taskType}/g, task.task_type)
            .replace(/{taskId}/g, task.external_id)
            .replace(/{labels}/g, task.labels ? JSON.parse(task.labels).join(', ') : 'None');

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
