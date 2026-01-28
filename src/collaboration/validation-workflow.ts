/**
 * Cross-Agent Validation Workflow
 *
 * Enables agents to verify each other's work through structured validation workflows.
 * Supports code review, risk assessment, quality checks, and security scans.
 */

import {
    generateId,
    insertAgentValidation,
    getAgentValidationById,
    getValidationsByPrd,
    getValidationsByRun,
    getPendingValidations,
    updateAgentValidation,
    getValidationSummary,
    insertWorkLog,
    type AgentValidation,
} from '../db/index.js';

export type ValidationType = 'code_review' | 'risk_assessment' | 'quality_check' | 'security_scan';
export type ValidationStatus = 'pending' | 'in_progress' | 'passed' | 'failed' | 'needs_revision';
export type ValidationVerdict = 'approve' | 'reject' | 'request_changes';
export type ValidationSeverity = 'info' | 'warning' | 'error' | 'critical';

export interface ValidationFinding {
    /** Type of finding */
    type: 'issue' | 'suggestion' | 'observation';
    /** Description of the finding */
    message: string;
    /** Severity level */
    severity: ValidationSeverity;
    /** File affected (if applicable) */
    file?: string;
    /** Line number (if applicable) */
    line?: number;
    /** Category (e.g., 'security', 'performance', 'style') */
    category?: string;
    /** Suggested fix */
    suggestion?: string;
}

export interface ValidationRequest {
    projectId: string;
    runId?: string;
    prdId?: string;
    validationType: ValidationType;
    validatorAgent: string;
    targetAgent?: string;
    targetArtifact?: string;
}

export interface ValidationResult {
    status: ValidationStatus;
    verdict?: ValidationVerdict;
    findings: ValidationFinding[];
    severity?: ValidationSeverity;
    summary?: string;
}

export interface ValidationInfo {
    id: string;
    projectId: string;
    runId?: string;
    prdId?: string;
    validationType: ValidationType;
    validatorAgent: string;
    targetAgent?: string;
    targetArtifact?: string;
    status: ValidationStatus;
    verdict?: ValidationVerdict;
    findings: ValidationFinding[];
    severity?: ValidationSeverity;
    createdAt: Date;
    completedAt?: Date;
}

export interface ValidationSummary {
    passed: number;
    failed: number;
    pending: number;
    needsRevision: number;
    total: number;
    allPassed: boolean;
    hasBlockers: boolean;
}

/**
 * Manages cross-agent validation workflows
 */
export class ValidationWorkflow {
    private projectId: string;
    private runId?: string;
    private agentName: string;

    constructor(projectId: string, agentName: string, runId?: string) {
        this.projectId = projectId;
        this.agentName = agentName;
        this.runId = runId;
    }

    /**
     * Request a validation from another agent
     */
    requestValidation(request: Omit<ValidationRequest, 'projectId' | 'runId'>): string {
        const id = generateId();

        insertAgentValidation({
            id,
            project_id: this.projectId,
            run_id: this.runId ?? null,
            prd_id: request.prdId ?? null,
            validation_type: request.validationType,
            validator_agent: request.validatorAgent,
            target_agent: request.targetAgent ?? null,
            target_artifact: request.targetArtifact ?? null,
            status: 'pending',
            verdict: null,
            findings: null,
            severity: null,
            completed_at: null,
        });

        insertWorkLog({
            id: generateId(),
            run_id: this.runId ?? null,
            project_id: this.projectId,
            event_type: 'started',
            summary: `Validation requested: ${request.validationType} by ${request.validatorAgent}`,
            details: JSON.stringify({
                validation_id: id,
                target_agent: request.targetAgent,
                target_artifact: request.targetArtifact,
            }),
        });

        return id;
    }

    /**
     * Get pending validations for the current agent
     */
    getPendingValidations(): ValidationInfo[] {
        const validations = getPendingValidations(this.agentName);
        return validations.map(this.toValidationInfo);
    }

    /**
     * Start working on a validation
     */
    startValidation(validationId: string): boolean {
        const validation = getAgentValidationById(validationId);
        if (!validation) return false;
        if (validation.validator_agent !== this.agentName) return false;
        if (validation.status !== 'pending') return false;

        updateAgentValidation(validationId, { status: 'in_progress' });
        return true;
    }

    /**
     * Complete a validation with results
     */
    completeValidation(validationId: string, result: ValidationResult): void {
        const validation = getAgentValidationById(validationId);
        if (!validation) return;
        if (validation.validator_agent !== this.agentName) return;

        // Determine overall severity from findings
        const severity = this.calculateOverallSeverity(result.findings);

        updateAgentValidation(validationId, {
            status: result.status,
            verdict: result.verdict ?? null,
            findings: JSON.stringify(result.findings),
            severity: result.severity ?? severity,
            completed_at: new Date().toISOString(),
        });

        insertWorkLog({
            id: generateId(),
            run_id: validation.run_id,
            project_id: validation.project_id,
            event_type: result.status === 'passed' ? 'completed' : 'failed',
            summary: `Validation ${result.status}: ${validation.validation_type}`,
            details: JSON.stringify({
                validation_id: validationId,
                verdict: result.verdict,
                findings_count: result.findings.length,
                severity,
            }),
        });
    }

    /**
     * Get validation by ID
     */
    getValidation(validationId: string): ValidationInfo | undefined {
        const validation = getAgentValidationById(validationId);
        if (!validation) return undefined;
        return this.toValidationInfo(validation);
    }

    /**
     * Get all validations for a PRD
     */
    getValidationsForPrd(prdId: string): ValidationInfo[] {
        const validations = getValidationsByPrd(prdId);
        return validations.map(this.toValidationInfo);
    }

    /**
     * Get all validations for the current run
     */
    getRunValidations(): ValidationInfo[] {
        if (!this.runId) return [];
        const validations = getValidationsByRun(this.runId);
        return validations.map(this.toValidationInfo);
    }

    /**
     * Get validation summary for a PRD
     */
    getValidationSummary(prdId: string): ValidationSummary {
        const summary = getValidationSummary(prdId);
        const total = summary.passed + summary.failed + summary.pending + summary.needsRevision;

        return {
            ...summary,
            total,
            allPassed: total > 0 && summary.failed === 0 && summary.needsRevision === 0 && summary.pending === 0,
            hasBlockers: summary.failed > 0,
        };
    }

    /**
     * Check if a PRD has all validations passed
     */
    isFullyValidated(prdId: string): boolean {
        const summary = this.getValidationSummary(prdId);
        return summary.allPassed && summary.total > 0;
    }

    /**
     * Check if there are blocking validation failures
     */
    hasBlockingFailures(prdId: string): boolean {
        const validations = getValidationsByPrd(prdId);
        return validations.some(v =>
            v.status === 'failed' &&
            (v.severity === 'error' || v.severity === 'critical')
        );
    }

    /**
     * Create a standard validation workflow for a PRD
     */
    createPrdValidationWorkflow(prdId: string): string[] {
        const validationIds: string[] = [];

        // Risk assessment
        validationIds.push(this.requestValidation({
            prdId,
            validationType: 'risk_assessment',
            validatorAgent: 'planner',
            targetArtifact: 'prd',
        }));

        // Quality check
        validationIds.push(this.requestValidation({
            prdId,
            validationType: 'quality_check',
            validatorAgent: 'qa',
            targetArtifact: 'prd',
        }));

        return validationIds;
    }

    /**
     * Create a code review validation workflow
     */
    createCodeReviewWorkflow(prdId: string, prUrl: string): string[] {
        const validationIds: string[] = [];

        // QA code review
        validationIds.push(this.requestValidation({
            prdId,
            validationType: 'code_review',
            validatorAgent: 'qa',
            targetAgent: 'developer',
            targetArtifact: prUrl,
        }));

        // Security scan
        validationIds.push(this.requestValidation({
            prdId,
            validationType: 'security_scan',
            validatorAgent: 'qa',
            targetAgent: 'developer',
            targetArtifact: prUrl,
        }));

        return validationIds;
    }

    /**
     * Wait for all validations to complete
     */
    async waitForValidations(
        validationIds: string[],
        options?: { pollIntervalMs?: number; timeoutMs?: number }
    ): Promise<ValidationInfo[]> {
        const pollInterval = options?.pollIntervalMs ?? 2000;
        const timeout = options?.timeoutMs ?? 600000; // 10 minutes default
        const startTime = Date.now();

        while (Date.now() - startTime < timeout) {
            const validations = validationIds.map(id => getAgentValidationById(id)).filter(Boolean);

            const allComplete = validations.every(v =>
                v && ['passed', 'failed', 'needs_revision'].includes(v.status)
            );

            if (allComplete) {
                return validations.map(v => this.toValidationInfo(v as AgentValidation));
            }

            await new Promise(resolve => setTimeout(resolve, pollInterval));
        }

        // Return current state on timeout
        return validationIds
            .map(id => getAgentValidationById(id))
            .filter(Boolean)
            .map(v => this.toValidationInfo(v as AgentValidation));
    }

    private calculateOverallSeverity(findings: ValidationFinding[]): ValidationSeverity | null {
        if (findings.length === 0) return null;

        const severityOrder: ValidationSeverity[] = ['info', 'warning', 'error', 'critical'];
        let maxSeverityIndex = 0;

        for (const finding of findings) {
            const index = severityOrder.indexOf(finding.severity);
            if (index > maxSeverityIndex) {
                maxSeverityIndex = index;
            }
        }

        return severityOrder[maxSeverityIndex];
    }

    private toValidationInfo(validation: AgentValidation): ValidationInfo {
        let findings: ValidationFinding[] = [];

        if (validation.findings) {
            try {
                findings = JSON.parse(validation.findings);
            } catch {
                // Keep empty array
            }
        }

        return {
            id: validation.id,
            projectId: validation.project_id,
            runId: validation.run_id ?? undefined,
            prdId: validation.prd_id ?? undefined,
            validationType: validation.validation_type,
            validatorAgent: validation.validator_agent,
            targetAgent: validation.target_agent ?? undefined,
            targetArtifact: validation.target_artifact ?? undefined,
            status: validation.status,
            verdict: validation.verdict ?? undefined,
            findings,
            severity: validation.severity ?? undefined,
            createdAt: new Date(validation.created_at),
            completedAt: validation.completed_at ? new Date(validation.completed_at) : undefined,
        };
    }
}

/**
 * Create a validation workflow for an agent
 */
export function createValidationWorkflow(
    projectId: string,
    agentName: string,
    runId?: string
): ValidationWorkflow {
    return new ValidationWorkflow(projectId, agentName, runId);
}

/**
 * Standard validation findings helpers
 */
export const ValidationFindings = {
    /**
     * Create an info finding
     */
    info(message: string, options?: { file?: string; line?: number; category?: string }): ValidationFinding {
        return {
            type: 'observation',
            message,
            severity: 'info',
            ...options,
        };
    },

    /**
     * Create a warning finding
     */
    warning(message: string, options?: { file?: string; line?: number; category?: string; suggestion?: string }): ValidationFinding {
        return {
            type: 'issue',
            message,
            severity: 'warning',
            ...options,
        };
    },

    /**
     * Create an error finding
     */
    error(message: string, options?: { file?: string; line?: number; category?: string; suggestion?: string }): ValidationFinding {
        return {
            type: 'issue',
            message,
            severity: 'error',
            ...options,
        };
    },

    /**
     * Create a critical finding
     */
    critical(message: string, options?: { file?: string; line?: number; category?: string; suggestion?: string }): ValidationFinding {
        return {
            type: 'issue',
            message,
            severity: 'critical',
            ...options,
        };
    },

    /**
     * Create a suggestion
     */
    suggestion(message: string, options?: { file?: string; line?: number; category?: string }): ValidationFinding {
        return {
            type: 'suggestion',
            message,
            severity: 'info',
            ...options,
        };
    },
};
