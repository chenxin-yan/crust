# Crust — Task Context

**Last Updated:** 2026-05-03
**Status:** Active
**Next Task ID:** TP-017

---

## Project Overview

**Crust** is a TypeScript-first, Bun-native CLI framework. It's distributed as
a family of `@crustjs/*` packages plus a `create-crust` scaffolder and the
end-user `crust` CLI for building and publishing standalone executables.

The repo is a **Turborepo monorepo** managed with **Bun workspaces**. Every
package is **ESM** (`"type": "module"`) and built with **bunup**. Linting and
formatting are handled by **Biome**. Type-checking uses **TypeScript** (`tsc`
with no emit). Tests use **`bun:test`**. Versioning and changelogs are managed
by **Changesets**.

The framework currently powers tools like
[Nia CLI](https://github.com/nozomio-labs/nia-cli).

---

## Repository Layout

```
crust/
├── apps/
│   └── docs/                 # Documentation site (consumer of @crustjs/*)
├── packages/                 # Published packages
│   ├── core/                 # Command definition, arg parsing, routing, plugins, errors
│   ├── crust/                # End-user CLI tooling — build & distribute executables
│   ├── plugins/              # Official plugins: help, version, did-you-mean, no-color, update-notifier
│   ├── style/                # Terminal styling foundation
│   ├── progress/             # Progress indicators for async CLI tasks
│   ├── prompts/              # Interactive terminal prompts
│   ├── validate/             # Validation helpers
│   ├── store/                # Typed persistence (config / data / state / cache)
│   ├── skills/               # Agent skill generation from Crust commands
│   ├── create/               # Headless scaffolding engine for create-* tools
│   ├── create-crust/         # `bun create crust` scaffolder
│   ├── config/               # Shared internal config (e.g., tsconfig, build presets)
│   └── man/                  # (internal) — see package.json for details
├── scripts/                  # Release & maintenance scripts (publish, etc.)
├── .changeset/               # Changesets metadata (DO NOT hand-edit changelogs)
├── taskplane-tasks/          # Task packets (this directory)
├── AGENTS.md                 # Agent-facing project rulebook
├── CONTRIBUTING.md           # Contributor guide (workflow, PR rules)
├── biome.json                # Lint + format config (tabs, double quotes)
├── turbo.json                # Pipeline definitions (build, test, check:types)
├── package.json              # Root scripts + workspaces
└── bun.lock                  # Lockfile
```

### Per-Package Notes

| Package | Notes |
|---------|-------|
| `core` | Foundation. Touches here ripple into every other package — bias toward extra review. |
| `crust` | Builds standalone executables — tests may need to spawn child processes. |
| `apps/docs` | Docs site. Does NOT need `bun run test`; build via `bun run build:docs`. |
| `create-crust` / `create` | Scaffolding tools — verify by running the scaffolder against a temp dir, not just unit tests. |
| `plugins` | User-facing; treat as public API. |
| `style`, `progress`, `prompts`, `validate`, `store`, `skills` | Standard utility packages — co-located unit tests in `src/*.test.ts`. |
| `config`, `man` | Internal. May be `"private": true`; no changeset needed for changes. |

---

## Conventions

### Code Style
- **Indent:** tabs (Biome enforced)
- **Quotes:** double quotes in JS/TS (Biome enforced)
- **Modules:** ESM only — no `require`, no CommonJS
- **Naming:** follow patterns already present in each package; do not introduce new conventions without strong reason

### Tests
- Framework: `bun:test` — `import { describe, expect, it, beforeEach, afterEach } from "bun:test"`
- **Unit tests:** co-located — `src/foo.test.ts` next to `src/foo.ts`
- **Integration / smoke tests:** under each package's `tests/` directory
- When fixing a bug: add a regression test that fails before the fix and passes after

### Bun Preference
Reach for Bun-native APIs when they exist:
- `Bun.file()` over `fs.readFileSync` for reads
- `Bun.spawn()` over `child_process` for subprocesses
- `bun:test` over Vitest / Jest
- `bun install` / `bun run` everywhere — never `npm` or `yarn`

### Commits & Changelogs
- Conventional-style commit messages encouraged (`feat:`, `fix:`, `refactor:`, `docs:`, `test:`)
- **DO NOT manually edit `CHANGELOG.md` files** — they are protected
- Run `bunx changeset` to record user-visible changes to published packages
- Changesets are consumed by `bun run packages:version` during release

### PR Rules
- Open PRs against `main`
- Always run `bun run check` and `bun run check:types` before submitting
- Run `bun run test` when behavior changes
- Add a changeset when a published package changes user-visibly

---

## Pre-flight Commands (every task should run these before delivery)

```sh
bun run check              # Biome lint + format
bun run check:types        # TypeScript type-check (turbo)
bun run test               # Run all tests
```

For task-scoped iteration, prefer per-package commands (faster):

```sh
cd packages/<name>
bun run check
bun run check:types
bun run test
```

---

## Tech Debt & Known Issues

_Items discovered during task execution are appended here by agents._

- [ ] **`@crustjs/validate` internal `ValueType` / primitive-resolution helpers** —
      TP-007 reduced the per-vendor copies from 3 → 1 (shared via the
      vendor-dispatch introspection registry under `src/introspect/`).
      A future cleanup task could plumb these through the new
      `@crustjs/utils` package created in TP-005, but TP-014 deliberately
      stays out of internal primitive consolidation — its scope is public
      API alignment only. TP-011 references this deferral.
- [ ] **`field(schema)` schema-derived defaults do NOT narrow TypeScript types**
      (TP-014 limitation). Standard Schema v1 has no spec-portable type-level
      access to defaults, so `field(z.string().default("x"))` types as
      `string | undefined` even though the runtime default is `"x"`. Users
      who want tight typing pass `field(schema, { default: x })` explicitly.
      A future task could add Zod-only type-level introspection if Zod
      starts exposing default values through its public type surface.

---

## Self-Documentation Targets

- **Tech debt log:** workers add entries to the `Tech Debt & Known Issues` section above when they discover issues outside their immediate task scope.
- **Architecture decisions:** if a task introduces a non-obvious pattern, summarize the decision in the relevant package README or here.

---

## Reference Docs (always loaded for workers)

- `AGENTS.md` — agent-facing project rulebook (build/lint/test commands, changelog rules, test conventions)
- `CONTRIBUTING.md` — contributor workflow (PR rules, package work, docs work)

---

## Key Files

| Category | Path |
|----------|------|
| Tasks | `taskplane-tasks/` |
| Config | `.pi/taskplane-config.json` |
| Agent overrides | `.pi/agents/` |
| Build pipeline | `turbo.json` |
| Lint/format | `biome.json` |
| Releases | `.changeset/` |
