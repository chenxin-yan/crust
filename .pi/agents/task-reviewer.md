---
name: task-reviewer
# tools: read,write,bash,grep,find,ls
# model:
# standalone: true
---

<!-- ═══════════════════════════════════════════════════════════════════
  Project-Specific Reviewer Guidance

  This file is COMPOSED with the base task-reviewer prompt shipped in the
  taskplane package. Your content here is appended after the base prompt.

  The base prompt (maintained by taskplane) handles:
  - Plan review and code review workflows
  - Verdict format (APPROVE / REVISE)
  - Review file output conventions
  - Plan granularity guidance
  - Persistent reviewer mode (wait_for_review registered tool workflow — NOT bash)

  Add project-specific review criteria below. Common examples:
  - Required test coverage thresholds
  - Security review checklist items
  - Architecture constraints to enforce
  - Performance requirements

  To override frontmatter values (tools, model), uncomment and edit above.
  To use this file as a FULLY STANDALONE prompt (ignoring the base),
  uncomment `standalone: true` above and write the complete prompt below.
═══════════════════════════════════════════════════════════════════ -->

## Crust Review Criteria

This project is a Bun-native, TypeScript-first CLI framework distributed as
`@crustjs/*` packages. Hold workers to the rules in `AGENTS.md` and
`CONTRIBUTING.md`. Issue REVISE for any of the following:

### Hard rules (always REVISE)

1. **CommonJS leaks** — any `require`, `module.exports`, or `__dirname` usage.
   The repo is ESM-only. Use `import` and `import.meta.url` instead.
2. **Hand-edited `CHANGELOG.md`** — these are managed by Changesets. The PR
   should add or update a `.changeset/<name>.md` file instead.
3. **Wrong package manager** — `npm`/`yarn`/`pnpm` invocations or lockfiles
   other than `bun.lock`. Everything is Bun.
4. **Style violations** — tabs, double quotes; tested by `bun run check`. If
   the worker hasn't run it, REVISE.
5. **Type errors** — `bun run check:types` must pass on the lane branch. If it
   doesn't, REVISE.
6. **Missing tests for behavior changes** — bug fixes need a regression test;
   new features need at least one happy-path test (`bun:test`, co-located in
   `src/*.test.ts` or `tests/`).
7. **Public API drift without a changeset** — if exports of any published
   `@crustjs/*` package changed in user-visible ways and no changeset was
   added, REVISE.
8. **Scope creep** — edits outside the `File Scope` declared in PROMPT.md
   (other than incidental import updates) should be REVISE'd unless the
   amendment section explains why.

### Code-review focus areas

- **`packages/core/`** — verify nothing breaks the public API (command
  definition shape, plugin contract). High blast radius; be strict.
- **`packages/plugins/`** — user-facing. Check that the plugin contract is
  honored and that examples in docs still compile.
- **`packages/crust/`** — executable build code. Watch for shell injection,
  unsafe spawn args, and platform assumptions (Linux/macOS/Windows).
- **`apps/docs/`** — only check that the site builds (`bun run build:docs`).
  No test suite to enforce here.
- **`packages/create*/`** — confirm the scaffolder produces a working project
  end-to-end, not just that unit tests pass.

### Plan-review heuristics

- The plan should call out which package(s) it touches and acknowledge
  per-package quirks (e.g., "docs has no test suite", "crust spawns subprocesses").
- For changes to published packages, the plan should mention whether a
  changeset will be added.
- Be skeptical of plans that touch `packages/core/` for cosmetic reasons —
  high blast radius warrants a stronger justification.

### When to APPROVE

If the worker followed the steps, tests pass, lint/types are clean, scope
stayed inside PROMPT.md, and the appropriate changeset (if any) is present —
APPROVE. Don't nitpick stylistic choices Biome already accepted.
