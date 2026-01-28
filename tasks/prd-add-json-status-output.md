# PRD: Add JSON Output Flag to Fleet Status Command

## Summary
Add a `--json` flag to the `fleet status` command that outputs structured JSON instead of the formatted terminal output. This enables machine-readable output for integration with other tools, CI/CD pipelines, and automation scripts.

## Technical Context
Based on the codebase analysis, Fleet is a TypeScript project using ESM modules with a CLI structure. The status command is located in `src/cli/commands/status.ts` and follows established patterns for command-line argument handling.

## User Stories

### US-001: Analyze Existing Status Command Structure
**Description:** As a developer, I want to understand the current status command implementation so that I can properly extend it with JSON output functionality.

**Acceptance Criteria:**
- Examine `src/cli/commands/status.ts` implementation
- Document current output format and data structure
- Identify data models used for status information
- Document existing command argument patterns in other CLI commands
- Typecheck passes

**Priority:** 1

### US-002: Add JSON Flag Option to Status Command
**Description:** As a user, I want to use a `--json` flag with the `fleet status` command so that I can get structured data output.

**Acceptance Criteria:**
- Add `--json` boolean flag to status command options
- Flag parsing follows existing CLI patterns in the codebase
- Command help text updated to include `--json` option
- Default behavior (without flag) remains unchanged
- Typecheck passes

**Priority:** 1

### US-003: Create JSON Output Data Structure
**Description:** As a developer, I want to define a proper TypeScript interface for the JSON output so that the data structure is well-typed and consistent.

**Acceptance Criteria:**
- Create TypeScript interface for status JSON output
- Include fields for: pending approvals, running tasks, blocked/failed runs
- Interface supports all data currently shown in terminal output
- Follow existing type definition patterns in the codebase
- Typecheck passes

**Priority:** 1

### US-004: Implement JSON Output Logic
**Description:** As a user, I want the `fleet status --json` command to output valid JSON so that I can process it with other tools.

**Acceptance Criteria:**
- When `--json` flag is used, output valid JSON to stdout
- JSON includes all status information: pending approvals, running tasks, blocked/failed runs
- JSON structure matches the defined TypeScript interface
- No terminal formatting or colors in JSON output
- Output is valid JSON (parseable by `JSON.parse()`)
- Typecheck passes

**Priority:** 1

### US-005: Preserve Terminal Output Behavior
**Description:** As a user, I want the default `fleet status` command (without --json) to work exactly as before so that existing workflows are not disrupted.

**Acceptance Criteria:**
- Default status command output unchanged
- Terminal formatting and colors preserved for non-JSON output
- Human-readable format maintained
- All existing status display logic works as before
- Typecheck passes

**Priority:** 2

### US-006: Add Unit Tests for JSON Output
**Description:** As a developer, I want comprehensive tests for the JSON output functionality so that the feature is reliable and maintainable.

**Acceptance Criteria:**
- Test JSON flag parsing
- Test JSON output structure matches interface
- Test JSON output is valid (parseable)
- Test default behavior unchanged when flag not used
- Tests use Vitest framework (matching project conventions)
- All tests pass
- Typecheck passes

**Priority:** 2

### US-007: Add Integration Tests
**Description:** As a developer, I want integration tests that verify the complete JSON output functionality so that the feature works end-to-end.

**Acceptance Criteria:**
- Test actual command execution with `--json` flag
- Verify JSON output contains expected status data
- Test with various status states (pending, running, blocked, etc.)
- Ensure JSON output doesn't interfere with other CLI functionality
- Use existing test patterns from the codebase
- All tests pass
- Typecheck passes

**Priority:** 3

## Technical Considerations

1. **File Modifications Required:**
   - `src/cli/commands/status.ts` - Main implementation
   - Test files in appropriate test directories
   - Possibly CLI argument parsing utilities if they exist

2. **Dependencies:**
   - Follow existing ESM module patterns
   - Use existing TypeScript configuration
   - Maintain compatibility with current CLI framework

3. **Error Handling:**
   - JSON output should handle error states gracefully
   - Invalid states should produce valid JSON with error information
   - Maintain existing error handling for terminal output

4. **Performance:**
   - JSON output should not significantly impact command performance
   - Avoid duplicate data fetching when possible

## Success Criteria
- `fleet status --json` produces valid, machine-readable JSON
- All existing functionality preserved
- Comprehensive test coverage
- Documentation updated appropriately
- Code follows existing project patterns and conventions