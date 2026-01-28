/**
 * Agent Collaboration Framework
 *
 * This module provides structured collaboration mechanisms for multi-agent
 * coordination and validation in Fleet.
 *
 * Components:
 * - ContextStore: Shared context and intermediate results across tasks
 * - HandoffManager: Structured handoffs between different agent types
 * - ValidationWorkflow: Cross-agent validation workflows
 */

// Context Store
export {
    ContextStore,
    createContextStore,
    type ContextType,
    type ContextEntry,
    type ContextStoreOptions,
} from './context-store.js';

// Handoff Manager
export {
    HandoffManager,
    createHandoffManager,
    HandoffPatterns,
    type HandoffType,
    type HandoffStatus,
    type HandoffPayload,
    type HandoffResult,
    type CreateHandoffOptions,
    type HandoffInfo,
} from './handoff-manager.js';

// Validation Workflow
export {
    ValidationWorkflow,
    createValidationWorkflow,
    ValidationFindings,
    type ValidationType,
    type ValidationStatus,
    type ValidationVerdict,
    type ValidationSeverity,
    type ValidationFinding,
    type ValidationRequest,
    type ValidationResult,
    type ValidationInfo,
    type ValidationSummary,
} from './validation-workflow.js';
