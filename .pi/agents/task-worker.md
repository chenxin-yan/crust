---
name: task-worker
# tools: read,write,edit,bash,grep,find,ls
# model:
# standalone: true
---

<!-- ═══════════════════════════════════════════════════════════════════
  Project-Specific Worker Guidance

  This file is COMPOSED with the base task-worker prompt shipped in the
  taskplane package. Your content here is appended after the base prompt.

  The base prompt (maintained by taskplane) handles:
  - STATUS.md-first workflow and checkpoint discipline
  - Multi-step execution (worker handles all remaining steps per invocation)
  - Iteration recovery (context limit → next invocation resumes from STATUS.md)
  - Git commit conventions (per-step commits) and .DONE file creation
  - Review protocol (inline reviews via review_step tool when available)
  - Review response handling
  - Test execution strategy (targeted tests during steps, full suite at gate)
  - File reading strategy (grep-first for large files, context budget awareness)

  Add project-specific rules below. Common examples:
  - Preferred package manager (pnpm, yarn, bun)
  - Test commands (make test, npm run test:unit)
  - Coding standards (linting, formatting)
  - Framework-specific patterns
  - Environment or deployment constraints

  To override frontmatter values (tools, model), uncomment and edit above.
  To use this file as a FULLY STANDALONE prompt (ignoring the base),
  uncomment `standalone: true` above and write the complete prompt below.
═══════════════════════════════════════════════════════════════════ -->

## Crust Project Rules

This is **Crust** — a Bun-native, TypeScript-first CLI framework distributed as
`@crustjs/*` packages in a Turborepo monorepo. Read `AGENTS.md` and
`CONTRIBUTING.md` once at the start of each task — they are the source of truth
for project rules.

### Package manager & runtime

- **Always use `bun`** — never `npm`, `yarn`, or `pnpm`. The lockfile is `bun.lock`.
- Common commands:
  - `bun install` — install deps (you usually don't need to run this; the worktree inherits node_modules)
  - `bun run check` — Biome lint + format
  - `bun run check:types` — TypeScript type-check across the workspace
  - `bun run test` — run all tests
  - `bun run build` / `bun run build:packages` / `bun run build:docs`
- Prefer per-package commands while iterating (faster):
  ```sh
  cd packages/<name>
  bun run check && bun run check:types && bun run test
  ```

### Code style (enforced by Biome — `bun run check`)

- **Tabs** for indentation
- **Double quotes** in JS/TS
- **ESM only** — every package is `"type": "module"`. No `require`, no CommonJS.
- Prefer **Bun-native APIs**: `Bun.file`, `Bun.spawn`, `bun:test`, etc., over Node equivalents.
- Don't introduce new file/naming conventions — follow what's already in the package you're touching.

### Tests

- Framework is `bun:test`: `import { describe, expect, it, beforeEach, afterEach } from "bun:test"`
- **Unit tests:** co-located — `src/foo.test.ts` beside `src/foo.ts`
- **Integration / smoke tests:** in `<package>/tests/`
- Bug fixes must include a regression test that fails before the fix.

### Changelogs (CRITICAL)

- **NEVER hand-edit `CHANGELOG.md` files** — they are managed by Changesets and are listed in `protectedDocs`.
- For user-visible changes to a published package, run `bunx changeset` and create a `.changeset/<name>.md` describing the change. The changeset file is what you commit; the changelog regenerates at release time.
- You usually don't need a changeset for: docs-only edits, test-only edits, internal refactors, CI changes.

### Per-package quirks

- `apps/docs/` — does NOT participate in `bun run test`. Verify with `bun run build:docs` or `bun run dev:docs`.
- `packages/crust/` — produces standalone executables. Tests may spawn child processes; allow extra time.
- `packages/core/` — touched by everything else. Be conservative; run the full test suite at the gate.
- `packages/create*/` — verify by running the scaffolder against a temp dir, not just unit tests.

### Definition of done — before marking a step or task complete

1. Targeted tests for the changed package pass.
2. `bun run check` is clean (no lint/format errors).
3. `bun run check:types` is clean.
4. If you changed runtime behavior of a published package, you've added or run `bunx changeset`.
5. STATUS.md checkboxes accurately reflect what's actually done.

### Things to avoid

- Mixing unrelated refactors into a task — stay inside the file scope declared in PROMPT.md.
- Touching `CHANGELOG.md`, `LICENSE`, or other protected docs.
- Adding a new dependency without checking whether Bun's stdlib already covers it.
- Bypassing Biome with disable comments unless absolutely necessary (and document why if you do).
