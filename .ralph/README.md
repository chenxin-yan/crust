# Ralph Starter

A methodology and automation toolkit for orchestrating long-running AI coding agents through iterative task execution. Inspired by [this video](https://www.youtube.com/watch?v=_IK18goX4X8) and other sources online.

## Quick Start

### Prerequisites

- An AI coding CLI tool (e.g., [opencode](https://github.com/opencode-ai/opencode), [claude](https://docs.anthropic.com/en/docs/claude-code), [aider](https://aider.chat/))
- Git
- [jq](https://jqlang.github.io/jq/) - JSON processor (install with `brew install jq` or `apt install jq`)

### Setup

Run the install script from your project root:

```bash
curl -fsSL https://raw.githubusercontent.com/chenxin-yan/ralph-starter/main/install.sh | bash
```

This will:

- Check prerequisites (`git`, `jq`, AI coding CLI)
- Clone ralph-starter into a `.ralph/` subdirectory
- Symlink skills to `.claude/skills/` for Claude Code CLI

Your project structure will look like:

```
 my-project/
 ├── src/              # Your project files
 ├── package.json
 ├── .claude/
 │   └── skills/       # Symlinked Ralph skills for Claude Code
 │       ├── create-spec/ -> .ralph/skills/create-spec/
 │       └── create-prd/  -> .ralph/skills/create-prd/
 └── .ralph/           # Ralph configuration
     ├── start.sh
     ├── config
     ├── PROMPT.md
     ├── SPEC.md
     ├── prd.json
     ├── progress.md
     └── skills/       # Skill source files (single source of truth)
```

<details>
<summary>Manual setup (without install script)</summary>

```bash
cd my-project
git clone https://github.com/chenxin-yan/ralph-starter.git .ralph
rm -rf .ralph/.git

# Symlink skills to Claude Code
mkdir -p .claude/skills/create-spec .claude/skills/create-prd
ln -sf ../../../.ralph/skills/create-spec/SKILL.md .claude/skills/create-spec/SKILL.md
ln -sf ../../../.ralph/skills/create-prd/SKILL.md .claude/skills/create-prd/SKILL.md
```

</details>

Then:

1. Configure your agent CLI in `.ralph/config` (optional — defaults to `opencode run`):

   ```bash
   # Edit .ralph/config and change RALPH_AGENT_CMD
   RALPH_AGENT_CMD="claude -p --dangerously-skip-permissions"  # Example: use Claude CLI instead
   ```

2. Write your project spec in `.ralph/SPEC.md`

3. Create your task list in `.ralph/prd.json`

4. Run Ralph from your project root:

   ```bash
   ./.ralph/start.sh
   ```

   The agent will run in your project root directory (where you invoke the script), while Ralph's config files are read from `./.ralph/`.

### Options

```bash
./.ralph/start.sh                    # Run until all tasks complete
./.ralph/start.sh --max-loops 10     # Limit to 10 iterations
./.ralph/start.sh --dry-run          # Show configuration without running
./.ralph/start.sh --help             # Show help message
```

### Updating

To update Ralph to the latest version, run the install script with `--update`:

```bash
curl -fsSL https://raw.githubusercontent.com/chenxin-yan/ralph-starter/main/install.sh | bash -s -- --update
```

This updates the framework files (`start.sh`, `PROMPT.md`, `skills/`) while preserving your project files (`config`, `SPEC.md`, `prd.json`, `progress.md`).

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                      ralph.sh Loop                          │
│                                                             │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐   │
│  │  Read   │───▶│  Agent  │───▶│ Update  │───▶│  Commit │   │
│  │ prd.json│    │  Works  │    │progress │    │ Changes │   │
│  │         │    │ on Task │    │   .md   │    │         │   │
│  └─────────┘    └─────────┘    └─────────┘    └─────────┘   │
│       │                                             │       │
│       └────────────── Next Iteration ◀──────────────┘       │
└─────────────────────────────────────────────────────────────┘
```

### Core Components

| File          | Description                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------- |
| `prd.json`    | Project task list with small, granular, actionable items                                    |
| `progress.md` | Running log that acts as "memory" between agent sessions                                    |
| `PROMPT.md`   | System prompt template that instructs the agent each iteration                              |
| `SPEC.md`     | High-level project spec — what you're building and why (stable, not implementation details) |
| `start.sh`    | The orchestration script that runs the agent loop                                           |
| `skills/`     | Directory containing skill prompts for creating/iterating on Ralph files                    |

### Workflow

1. Agent reads `prd.json` and identifies the highest-priority task with no dependencies (agent infers priority and dependencies from context)
2. Agent works on that single task, verifying implementation (tests, type checks, etc.)
3. Agent updates `progress.md` with notes for future iterations
4. Agent updates `prd.json` (marks task complete, update notes for other tasks)
5. Agent commits changes
6. Agent outputs completion signal
7. Script detects completion, starts next iteration
8. Loop continues until all tasks are complete (or max iterations reached)

## File Formats

### prd.json

The task list that drives the agent's work. Tasks should be small and granular - each completable in a single agent session.

| Field         | Type     | Description                                 |
| ------------- | -------- | ------------------------------------------- |
| `description` | string   | End goal - what should be achieved          |
| `subtasks`    | string[] | Ordered steps to complete the task          |
| `notes`       | string   | Context, constraints, or tips for the agent |
| `passed`      | boolean  | Whether the task is complete                |

**Note**: There is no explicit priority or dependency field. The agent analyzes the task list and determines which task to work on based on context, logical ordering, and what makes sense given the current state of the project.

### SPEC.md

The high-level project specification. Captures **what** you're building and **why** — goals, scope, tech stack choices, and architectural decisions. Implementation details (concrete tasks, exact thresholds, file-level structure) belong in `prd.json` and the codebase itself. A good spec is stable and rarely needs updating as the project evolves.

### PROMPT.md

The system prompt template sent to the agent each iteration. This contains the instructions that enforce the Ralph workflow.

### progress.md

The progress file is **append-only** - the agent adds new entries after each task but never modifies previous entries. This creates an immutable log that serves as a handoff document between agent sessions. Each entry is separated by `---`.

## Configuration

Ralph is configured via the `config` file, which is automatically sourced by `start.sh`. You can also set environment variables, which take precedence over config file values.

### Configuration Reference

| Variable                    | Description                         | Default                                              |
| --------------------------- | ----------------------------------- | ---------------------------------------------------- |
| `RALPH_AGENT_CMD`           | Command to invoke the agent CLI     | `opencode run`                                       |
| `RALPH_MODEL`               | Model in provider/model format      | `anthropic/claude-opus-4-5`                          |
| `RALPH_PRD_FILE`            | Path to task file                   | `prd.json`                                           |
| `RALPH_PROGRESS_FILE`       | Path to progress log                | `progress.md`                                        |
| `RALPH_PROMPT_FILE`         | Path to prompt template             | `PROMPT.md`                                          |
| `RALPH_SPEC_FILE`           | Path to project spec                | `SPEC.md`                                            |
| `RALPH_COMPLETE_SIGNAL`     | String agent outputs when done      | `RALPH_TASK_COMPLETE`                                |
| `RALPH_RATE_LIMIT_PATTERN`  | Regex pattern to detect rate limits | `rate.limit\|429\|quota.exceeded\|too.many.requests` |
| `RALPH_RATE_LIMIT_COOLDOWN` | Cooldown period in seconds          | `60`                                                 |
| `RALPH_LOG_FILE`            | Log file path (empty to disable)    | `ralph.log`                                          |

**Note**: File paths can be relative (resolved from `start.sh` directory) or absolute. This allows you to place all Ralph files in a subdirectory (e.g., `./.ralph/`) while the agent runs from your project root.

## Logging

Ralph logs all script output and agent responses to `ralph.log` by default. The log includes:

- Session start timestamps
- Iteration markers with task counts
- Full agent output
- Completion/error status for each iteration
- Rate limit events

To disable logging, set `RALPH_LOG_FILE=""` in your config or environment.

## Supported Agent CLIs

Ralph is designed to be CLI-agnostic. The prompt is passed as the **last argument** to the configured command.

| CLI      | Configuration                                                | Notes                                                                                     |
| -------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| opencode | `RALPH_AGENT_CMD="opencode run"`                             | Runs with message as argument                                                             |
| claude   | `RALPH_AGENT_CMD="claude -p --dangerously-skip-permissions"` | `-p` print mode (non-interactive)                                                         |
| Custom   | `RALPH_AGENT_CMD="<command>"`                                | Any CLI that accepts a prompt as the last argument and allow agent to be run autonomously |

## Skills - Helper Prompts

The `skills/` directory contains specialized prompts to help you create and refine Ralph configuration files:

### create-spec (`skills/create-spec/SKILL.md`)

A guide for creating or refining your `SPEC.md` file. This skill helps you:

- Define a clear project overview (what, why, who)
- Scope high-level capabilities and explicit boundaries
- Make explicit technical stack decisions
- Document architectural decisions (patterns, not file trees)
- Set directional constraints (not implementation-level targets)

**Usage**: Load this skill in your AI assistant when creating or iterating on your project specification.

### create-prd (`skills/create-prd/SKILL.md`)

A guide for breaking down your project into actionable tasks in `prd.json`. This skill helps you:

- Create properly-sized tasks (completable in one agent session)
- Write specific, actionable subtasks
- Include verification + code quality checks (tests, type checking, linting)
- Order tasks logically without explicit dependencies
- Avoid overlapping scope between tasks

**Usage**: Load this skill in your AI assistant when creating or refining your task list. Reference your `SPEC.md` for context.

## Tips for Writing Good Tasks

1. **Keep tasks small**: Each task should be completable and actionable in a single agent session
2. **Subtasks must be specific**: Break down the work into concrete steps (e.g., "Create POST /auth/login endpoint", "Add JWT token generation", "Write integration tests for login flow")
3. **Include verification + code quality checks**: End every task with test, type check (`npm run typecheck`), and lint/format (`npm run lint`) subtasks
4. **Provide context**: Use the `notes` field to guide the agent with constraints or tips
5. **Order logically**: While the agent infers dependencies, ordering tasks logically helps

> **Tip**: Use the `create-prd` skill prompt with your AI assistant to get expert guidance on task breakdown.

## License

MIT License - See [LICENSE](LICENSE) file
