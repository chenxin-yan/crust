# AGENTS.md — Crust CLI Framework

## Project Overview

Crust is a Bun-native, TypeScript-first CLI framework. **Turborepo** monorepo, **Bun** package manager/runtime, **Biome** linter/formatter, **bunup** build tool. All packages are **ESM** (`"type": "module"`).

## Build / Lint / Test Commands

```sh
# ── Monorepo root ────────────────────────────────────────────────────────
bun install                          # Install all deps
bun run build                        # Build all packages (turbo)
bun run check                        # Biome lint + format check
bun run check:types                  # TypeScript type-check all packages
bun run test                         # Run all tests across packages
```

**Always run `bun run check` and `bun run check:types` before submitting changes.**

## Changelog Management

**DO NOT manually edit `CHANGELOG.md` files.** This project uses [Changesets](https://github.com/changesets/changesets) for version management and changelog generation.

- To document a change, run `bunx changeset` and follow the prompts
- This creates a `.changeset/<name>.md` file describing your changes
- Changesets are consumed during release to generate changelogs and bump versions

### Test Framework & Conventions

- Tests use **bun:test**: `import { describe, expect, it, beforeEach, afterEach } from "bun:test"`
- **Unit tests**: co-located — `src/foo.test.ts` beside `src/foo.ts`
- **Integration/smoke tests**: in `tests/` directory
