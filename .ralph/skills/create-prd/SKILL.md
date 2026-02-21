---
name: create-prd
description: Create and manage prd.json task lists for Ralph AI coding agent. Use when asked to "create tasks", "add task", "create PRD", "break down features", "plan implementation", or when managing Ralph project tasks.
license: MIT
metadata:
  author: chenxin-yan
  version: "0.2.0"
---

# PRD/Task Creation Helper

Create and manage `prd.json` task lists for Ralph — an AI coding agent that loops through tasks: reads `prd.json`, picks ONE task, completes it, marks `passed: true`, repeats until done.

Task quality directly determines agent performance. Follow the rules below strictly.

## Output Schema

```json
{
  "tasks": [
    {
      "description": "Clear end-goal of the task",
      "subtasks": ["Specific step 1", "Specific step 2", "Verification step"],
      "notes": "Context, constraints, references, or tips",
      "passed": false
    }
  ]
}
```

- `description`: What should be achieved when done. Clear and specific.
- `subtasks`: Ordered, actionable implementation steps.
- `notes`: Context and constraints for the agent. Can be empty string.
- `passed`: Always `false` for new tasks.

## Task Rules

### 1. Right-sized tasks

Each task must be completable in a single agent session (~1-2 hours of human work).

```
GOOD: "Implement POST /api/auth/register endpoint"
BAD:  "Build the authentication system" → split into 4-6 tasks
```

If it would take a full day, break it down. If it takes 15 minutes, combine with related work.

### 2. Specific, actionable subtasks

```json
// GOOD
"subtasks": [
  "Create src/models/user.ts with User interface",
  "Define fields: id (UUID), email (string), passwordHash (string), createdAt (Date)",
  "Add Zod schema for validation",
  "Export UserCreate and UserResponse types"
]

// BAD
"subtasks": ["Create user model", "Add fields", "Add validation"]
```

### 3. Every task MUST end with verification + code quality checks

The final subtasks of every task must include:

1. **Tests**: Run the project's test suite
2. **Type checking**: Run the type check script (e.g., `npm run typecheck`, `npx tsc --noEmit`)
3. **Linting/Formatting**: Run the linter/formatter (e.g., `npm run lint`, `npm run format:check`)

Check `package.json` scripts or equivalent config to determine the correct commands.

```json
"subtasks": [
  "... implementation steps ...",
  "Write tests for success and failure cases",
  "Run npm test to verify all tests pass",
  "Run npm run typecheck to ensure no type errors",
  "Run npm run lint to ensure code quality"
]
```

> If the project lacks these tools, the setup task should configure them. All subsequent tasks must include these checks.

### 4. No overlapping scope

Each task must have clear boundaries. No two tasks should modify the same files or implement the same logic.

```json
// BAD — overlapping
{ "description": "Create User model", "subtasks": ["Define schema", "Add validation", "Create API routes"] },
{ "description": "Build user API", "subtasks": ["Create routes for users", "Add validation"] }

// GOOD — clear boundaries
{ "description": "Create User model and validation schemas", "subtasks": ["Define schema", "Add Zod validation", "Export types"] },
{ "description": "Implement User CRUD API endpoints", "subtasks": ["Create GET /api/users", "Create POST /api/users"] }
```

### 5. Useful notes

Include in `notes`: references to SPEC.md decisions, constraints, related files, gotchas, edge cases, and context about previous tasks.

### 6. Logical ordering

Ralph infers task order from the list position. Order tasks as:

1. Setup/configuration
2. Core models/types
3. Core features
4. Integrations
5. Polish and edge cases
6. Integration/E2E tests

## Workflows

Determine workflow from the user's request:

| User Intent                                             | Workflow              |
| ------------------------------------------------------- | --------------------- |
| "Create PRD", "plan the project", "break down the spec" | **Full PRD Creation** |
| "Add a task", "create a task for X"                     | **Incremental**       |
| Unclear                                                 | Ask the user          |

### Full PRD Creation

1. **Get context**: Read `SPEC.md` if it exists. Otherwise, use the user's description. If neither exists, explore the codebase (directory structure, manifests, entry files, tests) and summarize your understanding to the user for confirmation.
2. **Analyze**: Identify setup requirements, data models, features, API endpoints, frontend components, integrations, and testing needs.
3. **Propose tasks**: Create the ordered task list following all rules above.
4. **Get feedback**: Present the list and ask about ordering, sizing, missing features, and tasks to combine/split.
5. **Refine and output**: Incorporate feedback and generate `prd.json`.

### Incremental Task Management

1. **Read existing `prd.json`** to avoid duplicates and match existing style.
2. **Explore codebase** briefly if needed for context.
3. **Create one well-formed task** following all rules above.
4. **Present to user** for confirmation.
5. **Append to `prd.json`** (or create it if it doesn't exist), placing logically based on dependencies.

## Examples

### Project Setup

```json
{
  "description": "Initialize project with TypeScript, ESLint, and Prettier",
  "subtasks": [
    "Run npm init -y to create package.json",
    "Install TypeScript and initialize with npx tsc --init",
    "Configure tsconfig.json with strict mode, ES2022 target, and path aliases",
    "Install and configure ESLint with TypeScript plugin",
    "Install and configure Prettier with ESLint integration",
    "Add scripts to package.json: build, typecheck, lint, format",
    "Create src/index.ts with a simple console.log to verify setup",
    "Run npm run build && npm run typecheck to verify configuration",
    "Run npm run lint && npm run format:check to verify code quality tooling"
  ],
  "notes": "Use ESM modules (type: module in package.json). Target Node.js 18+.",
  "passed": false
}
```

### Data Model

```json
{
  "description": "Create User model with Prisma schema and TypeScript types",
  "subtasks": [
    "Add User model to prisma/schema.prisma with fields: id (UUID), email, passwordHash, name, createdAt, updatedAt",
    "Add unique constraint on email, set id default to uuid()",
    "Run npx prisma migrate dev --name add-user-model",
    "Create src/types/user.ts with User, UserCreate, and UserResponse types",
    "Create src/lib/validation/user.ts with Zod schemas for each type",
    "Run npx prisma generate to update client",
    "Run npm run typecheck to ensure no type errors",
    "Run npm run lint to ensure code quality"
  ],
  "notes": "Ensure passwordHash is never included in UserResponse type. Email should be lowercase and trimmed.",
  "passed": false
}
```

### API Endpoint

```json
{
  "description": "Implement POST /api/auth/register endpoint",
  "subtasks": [
    "Create src/routes/auth/register.ts",
    "Add POST handler that accepts { email, password, name }",
    "Validate request body using Zod schema from src/lib/validation/user.ts",
    "Check if user with email already exists, return 409 if so",
    "Hash password with bcrypt (12 rounds)",
    "Create user in database with Prisma",
    "Return 201 with user data (excluding passwordHash)",
    "Write tests in tests/routes/auth/register.test.ts",
    "Test: successful registration returns 201",
    "Test: duplicate email returns 409",
    "Test: invalid email format returns 400",
    "Run npm test to verify all tests pass",
    "Run npm run typecheck to ensure no type errors",
    "Run npm run lint to ensure code quality"
  ],
  "notes": "Follow error response format in src/lib/errors.ts. Use the db client from src/lib/db.ts.",
  "passed": false
}
```

## Validation Checklist

Before finalizing, verify every task meets:

- [ ] Completable in a single agent session
- [ ] Subtasks are specific and actionable
- [ ] Ends with test + type check + lint/format subtasks
- [ ] No overlapping scope with other tasks
- [ ] Logically ordered (setup → models → features → polish)
- [ ] Notes provide helpful context
- [ ] Valid JSON following the schema
