# AGENTS.md — Crust CLI Framework

## Project Overview

Crust is a Bun-native, TypeScript-first CLI framework. **Turborepo** monorepo, **Bun** package manager/runtime, **Biome** linter/formatter, **bunup** build tool. All packages are **ESM** (`"type": "module"`).

### Monorepo Packages

| Package             | Path                    | Description                                                         |
| ------------------- | ----------------------- | ------------------------------------------------------------------- |
| `@crustjs/core`     | `packages/core`         | Core: command definition, arg parsing, routing, plugins, errors     |
| `@crustjs/plugins`  | `packages/plugins`      | Official plugins: help, version, autocomplete                       |
| `@crustjs/crust`    | `packages/crust`        | CLI tooling — build and distribute standalone executables           |
| `@crustjs/style`    | `packages/style`        | Terminal styling foundation                                         |
| `@crustjs/prompts`  | `packages/prompts`      | Interactive terminal prompts                                        |
| `@crustjs/validate` | `packages/validate`     | Validation helpers                                                  |
| `@crustjs/create`   | `packages/create`       | Headless scaffolding engine for building create-xxx tools           |
| `create-crust`      | `packages/create-crust` | Project scaffolding tool                                            |
| `@crustjs/config`   | `packages/config`       | Shared TypeScript config (`tsconfig.base.json`)                     |
| docs                | `apps/docs`             | Documentation site (Vite + TanStack Router, deployed to Cloudflare) |

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

## Code Style Guidelines

### Biome (Formatter & Linter)

- **Indent**: Tabs — **Quotes**: Double — **Semicolons**: enabled (default)
- **Import organization**: automatic via Biome `organizeImports` assist
- Biome is the single source of truth — no Prettier, no ESLint.
- **`biome-ignore` directives**: suppress only with a justification comment, e.g.:

  ```ts
  // biome-ignore lint/complexity/noBannedTypes: empty base case for recursive intersection
  ```

### Error Handling

- `CrustError` with typed codes: `DEFINITION`, `VALIDATION`, `PARSE`, `EXECUTION`, `COMMAND_NOT_FOUND`
- Framework errors: `throw new CrustError("VALIDATION", "message")`
- User command errors: `throw new Error("message")`
- Chain causes: `.withCause(originalError)`
- Type-narrow: `error.is("COMMAND_NOT_FOUND")` returns typed `.details`
- `runCommand` wraps non-CrustError into `CrustError("EXECUTION", ...)`
- `runMain` is the top-level entry; catches all errors and sets `process.exitCode = 1`

### Code Organization

- **Section dividers** for major sections:

  ```ts
  // ────────────────────────────────────────────────────────────────────────────
  // Section Name — Brief description
  // ────────────────────────────────────────────────────────────────────────────
  ```

- **JSDoc** on public APIs: `@example`, `@param`, `@returns`, `@throws`
- **Inline comments**: explain _why_, not _what_
- **Function declarations** (not arrows) for internal helpers — arrows only for inline callbacks
- Keep functions small; extract helpers as named `function` declarations
