# Fleet

Multi-agent orchestration system that pulls tasks from Jira/Linear/GitHub, generates PRDs, and executes them via Ralph autonomous loops.

## Quick Start

```bash
# Install dependencies
npm install

# Build
npm run build

# Link globally
npm link

# Add a project
fleet projects add ~/code/myproject --github owner/repo

# Sync tasks from all sources
fleet sync

# Review and approve PRDs
fleet approve

# Execute approved tasks
fleet run

# Morning briefing
fleet status
```

## Commands

| Command | Description |
|---------|-------------|
| `fleet status` | Morning briefing - overnight work, pending approvals, priorities |
| `fleet approve` | Interactive approval of pending PRDs |
| `fleet run` | Execute approved tasks via Ralph (parallel) |
| `fleet projects list` | List configured projects |
| `fleet projects add <path>` | Add project with wizard |
| `fleet sync` | Pull latest tasks from all sources |
| `fleet plan` | Generate PRDs for high-priority backlog tasks |
| `fleet strategic` | Run strategic audit (mission alignment, scope creep) |
| `fleet config [key] [value]` | View or set global configuration |

## Per-Project Configuration

Each project has a `fleet.json` file:

```json
{
  "projectId": "uuid",
  "name": "My Project",
  "taskSource": {
    "type": "github",
    "owner": "owner",
    "repo": "repo"
  },
  "mission": "Project mission statement",
  "agents": {
    "planner": true,
    "developer": true,
    "qa": true,
    "strategic": true
  },
  "approval": {
    "autoApproveThreshold": 30,
    "requireApprovalTypes": ["feature", "refactor"]
  },
  "execution": {
    "maxConcurrentAgents": 2,
    "defaultIterations": 10,
    "tool": "claude",
    "branchPrefix": "fleet/"
  }
}
```

## Task Sources

### GitHub
Uses `gh` CLI for authentication. Run `gh auth login` first.

```bash
fleet projects add ~/code/myproject --github owner/repo
```

### Jira
Requires environment variables:
- `ATLASSIAN_SITE` - Your Atlassian site name
- `ATLASSIAN_EMAIL` - Your email
- `ATLASSIAN_API_TOKEN` - API token from Atlassian

```bash
fleet projects add ~/code/myproject --jira PROJECT_KEY
```

### Linear
Requires `LINEAR_API_KEY` environment variable.

```bash
fleet projects add ~/code/myproject --linear team_id
```

## Agents

### Planner Agent
Generates PRDs from backlog tasks using Claude. Includes risk scoring.

### Developer Agent
Spawns Ralph loops to execute approved PRDs. Creates branches and commits.

### QA Agent
Reviews pull requests and provides feedback using Claude.

### Strategic Agent
Audits projects for mission alignment and scope creep. Run weekly via cron.

## Risk Scoring

PRDs are scored 0-100 based on:
- Story count (30%)
- Estimated file changes (25%)
- Database migrations (20%)
- API changes (15%)
- Task type (10%)

Scores:
- < 30: Auto-approve
- 30-70: Queue for review
- > 70: Require explicit approval

## Data Storage

Fleet stores data in `~/.fleet/`:
- `fleet.db` - SQLite database
- `config.json` - Global configuration

## Environment Variables

```bash
# Required for Jira
ATLASSIAN_API_TOKEN=xxx
ATLASSIAN_EMAIL=xxx
ATLASSIAN_SITE=xxx

# Required for Linear
LINEAR_API_KEY=xxx

# Required for agents
ANTHROPIC_API_KEY=xxx
```

## Morning Ritual

Add to your shell profile for easy access:

```bash
alias morning="fleet status"
```

Then start each day with:

```bash
morning
```
