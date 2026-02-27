---
name: create-spec
description: Create or refine SPEC.md technical specifications for Ralph AI coding agent. Use when asked to "create spec", "write specification", "define requirements", "plan architecture", or when setting up a new project.
license: MIT
metadata:
  author: chenxin-yan
  version: "0.2.0"
---

# SPEC Creation Helper

Create or refine `SPEC.md` for Ralph — an AI coding agent that reads `SPEC.md` at the start of every iteration to understand what it's building.

## Core Principles

- **SPEC.md captures what and why.** High-level goals, scope, and architectural decisions. Not implementation steps — those belong in `prd.json`.
- **Codebase is source of truth.** The agent reads code for implementation details. SPEC.md should not duplicate what the code already shows.
- **Keep it stable.** A good spec rarely changes. If you're constantly updating it, you're putting implementation details in the wrong place.
- **Universal scope.** SPEC.md describes the project as it should be — not tied to "v1" or a single milestone. Use `prd.json` for phased work.

## Output Template

```markdown
# Project Name

> One-line description of the project.

## Overview

[2-3 paragraphs: what you're building, the problem it solves, and who it's for]

## Scope

### Included
- [High-level capability 1]
- [High-level capability 2]

### Excluded
- [What this project will NOT do]

## Technical Stack

- **Language**: [e.g., TypeScript 5.x with strict mode]
- **Framework**: [e.g., Next.js 14 with App Router]
- **Database**: [e.g., PostgreSQL 15 with Prisma ORM]
- **Authentication**: [e.g., NextAuth.js with JWT]
- **Testing**: [e.g., Vitest + Playwright]
- **Other**: [Any other key technologies]

## Architecture

[High-level patterns, system structure, how major components communicate]

## Constraints

- [e.g., All code must pass TypeScript strict mode]
- [e.g., API responses must stay under 200ms p95]
- [e.g., Node.js 18+ required]

## References

- [Links to design mockups, external API docs, or prior art]
```

## Section Rules

### 1. Overview — what, why, who

Clearly state what the project is, the problem it solves, and the target users. Vagueness here cascades everywhere.

```
GOOD: "A REST API for managing inventory in small retail stores,
      reducing manual stock counting by 80%."
BAD:  "A cool app for managing stuff."
```

### 2. Scope — high-level capabilities, not implementation tasks

List what the project does and doesn't do. Think capabilities, not user stories or acceptance criteria — those belong in `prd.json`.

```
GOOD (spec):
- User authentication and role-based access control
- Real-time inventory tracking across multiple locations

BAD (belongs in prd.json):
- User can reset password via email link with 24h expiry token
- POST /api/auth/register returns 201 with JWT
```

Always include an **Excluded** section. Without boundaries, the agent will over-build.

### 3. Technical Stack — eliminate all guesswork

Every major technology choice must be explicit. If the agent has to guess, it will guess wrong.

```
GOOD:
- **Language**: TypeScript 5.x with strict mode
- **Framework**: Next.js 14 with App Router
- **Database**: PostgreSQL 15 with Prisma ORM

BAD:
- Some backend framework
- A database
```

Include: language, framework, database + access method, infrastructure, key libraries.

### 4. Architecture — decisions, not file trees

Describe the high-level patterns and how components interact. Do NOT document directory structure or file-level organization — the codebase shows that.

```
GOOD: "Monolithic Express app with layered architecture:
      routes → controllers → services → repositories.
      All business logic lives in the service layer."

BAD:  "src/routes/ contains route files, src/controllers/
      contains controller files, src/services/ ..."
```

Optional for simple projects.

### 5. Constraints — guiding principles, not exact targets

Capture non-functional requirements that guide the agent's decisions. Keep them directional — exact thresholds and metrics belong in `prd.json` task notes.

Categories: performance, security, compatibility, code quality.

### 6. References — link external context

Links to design mockups, API docs, similar projects. Optional — omit if none exist.

## Workflows

| User Intent                                              | Workflow       |
| -------------------------------------------------------- | -------------- |
| "Create spec", "define requirements", "plan the project" | **Create**     |
| "Review spec", "improve spec", "update spec"             | **Refine**     |
| Unclear                                                  | Ask the user   |

### Create

1. **Gather requirements** — ask the user:
   - What are you building? What problem does it solve? Who uses it?
   - What's in scope? What's explicitly out?
   - What language/framework/database? Key libraries?
   - High-level architecture (monolith, microservices, serverless)?
   - Any hard constraints (performance, security, compatibility)?
2. **Draft the spec** following the output template and section rules.
3. **Present for feedback** — ask about missing scope, unclear decisions, or tech stack changes.
4. **Refine and output** the final `SPEC.md`.

### Refine

1. **Read existing `SPEC.md`** and evaluate against section rules.
2. **Identify gaps** — missing sections, vague scope, unspecified tech, no boundaries, implementation details that should move to `prd.json`.
3. **Ask clarifying questions** to fill gaps.
4. **Output the refined `SPEC.md`**.

## Validation Checklist

- [ ] Overview clearly states what, why, and who
- [ ] Scope lists high-level capabilities (not implementation tasks)
- [ ] Excluded section defines explicit boundaries
- [ ] All major technology choices specified
- [ ] Architecture describes patterns, not file structure
- [ ] Constraints are directional, not over-specified
- [ ] No implementation details that belong in `prd.json`
- [ ] Stable — won't need updating as code evolves
