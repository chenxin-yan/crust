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

### Test Framework & Conventions

- Tests use **bun:test**: `import { describe, expect, it, beforeEach, afterEach } from "bun:test"`
- **Unit tests**: co-located — `src/foo.test.ts` beside `src/foo.ts`
- **Integration/smoke tests**: in `tests/` directory
