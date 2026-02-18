# AGENTS.md — Crust CLI Framework

## Project Overview

Crust is a Bun-native, TypeScript-first CLI framework. It is a **Turborepo monorepo** using **Bun** as the package manager and runtime, **Biome** for linting/formatting, and **bunup** for building packages.

### Monorepo Packages

| Package | Path | Description |
|---------|------|-------------|
| `@crustjs/core` | `packages/core` | Core library: command definition, argument parsing, routing, plugin system, error types |
| `@crustjs/plugins` | `packages/plugins` | Official plugins: help, version, autocomplete |
| `@crustjs/crust` | `packages/crust` | The `crust` CLI binary (self-hosted, built with `@crustjs/core`) |
| `@crustjs/create-crust` | `packages/create-crust` | Project scaffolding tool |
| `@crustjs/config` | `packages/config` | Shared TypeScript config (`tsconfig.base.json`) |

## Build / Lint / Test Commands

```sh
# ── From monorepo root ──────────────────────────────────────────────────
bun install                          # Install all dependencies
bun run build                        # Build all packages (turbo)
bun run check                        # Lint + format check (biome check)
bun run check:types                  # TypeScript type check all packages
bun run test                         # Run all tests across all packages

# ── Single package (from root, using turbo filter) ──────────────────────
bun run build --filter=@crustjs/core   # Build a specific package
bun run test --filter=@crustjs/core    # Test a specific package

# ── Single package (from package directory) ─────────────────────────────
cd packages/core && bun test                     # Run all tests in @crustjs/core
cd packages/core && bun test src/parser.test.ts  # Run a single test file
cd packages/core && bun test --test-name-pattern "executes run"  # Run by test name

# ── Dev mode ────────────────────────────────────────────────────────────
bun run dev                          # Dev mode for all packages (watch)
cd packages/crust && bun run dev     # Run the crust CLI in dev mode
```

### Test Framework

Tests use **bun:test** (Bun's built-in test runner). Import from `"bun:test"`:

```ts
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
```

### Test File Naming & Location

- **Unit tests**: Co-located with source — `src/foo.test.ts` alongside `src/foo.ts`
- **Integration tests**: In `tests/` directory — `tests/integration.test.ts`
- **Smoke tests**: In `tests/` directory — `tests/smoke.test.ts`
- Test helper utilities go in `tests/helpers.ts`

## Code Style Guidelines

### Formatter & Linter (Biome)

The project uses **Biome v2** with these settings:
- **Indent**: Tabs (not spaces)
- **Quotes**: Double quotes for JS/TS
- **Linter**: Biome recommended rules enabled
- **Imports**: Auto-organized by Biome (`organizeImports: "on"`)

Run `bun run check` before committing. Biome is the single source of truth for formatting — do not use Prettier or ESLint.

### TypeScript Configuration

Strict mode is enabled with these notable settings:
- `strict: true`
- `noFallthroughCasesInSwitch: true`
- `noUncheckedIndexedAccess: true` — indexed access returns `T | undefined`
- `noImplicitOverride: true`
- `verbatimModuleSyntax: true` — use `import type` for type-only imports
- `target: ESNext`, `module: Preserve`

### Imports

- **Always use `.ts` extensions** in relative imports: `import { foo } from "./bar.ts"`
- **Use `import type`** for type-only imports (enforced by `verbatimModuleSyntax`):
  ```ts
  import type { AnyCommand, CommandContext } from "./types.ts";
  import { CrustError } from "./errors.ts";
  ```
- **Workspace imports** use package names: `import { defineCommand } from "@crustjs/core"`
- **Node built-ins** use `node:` prefix: `import { resolve } from "node:path"`
- Biome auto-sorts imports — let it handle ordering

### Naming Conventions

- **Files**: `camelCase.ts` for source, `camelCase.test.ts` for tests
- **Types/Interfaces**: `PascalCase` — e.g. `CommandDef`, `FlagsDef`, `ParseResult`
- **Type parameters**: Short uppercase — `A extends ArgsDef`, `F extends FlagsDef`, `S`, `T`, `C`
- **Functions**: `camelCase` — e.g. `defineCommand`, `parseArgs`, `resolveCommand`
- **Constants**: `camelCase` — e.g. `buildCommand`, `helpPlugin`
- **Interfaces over type aliases** for object shapes; `type` for unions, mapped types, and utilities
- **Plugin factory functions**: `camelCase` returning `CrustPlugin` — e.g. `helpPlugin()`, `versionPlugin()`

### Error Handling

- Use the custom `CrustError` class with typed error codes (`DEFINITION`, `VALIDATION`, `PARSE`, `EXECUTION`, `COMMAND_NOT_FOUND`)
- Throw `CrustError` for framework-level errors; throw plain `Error` for user command errors
- `CrustError` carries a `.code` for programmatic handling — use `error.is("CODE")` for type narrowing
- `runCommand` wraps non-CrustError exceptions into `CrustError("EXECUTION", ...)`
- `runMain` is the top-level entry point that catches all errors and sets `process.exitCode = 1`
- Use `.withCause(error)` to chain original errors

```ts
// Framework error
throw new CrustError("VALIDATION", `Missing required flag "--${name}"`);

// User command error
throw new Error(`Entry file not found: ${entryPath}`);

// Error narrowing
if (error instanceof CrustError && error.is("COMMAND_NOT_FOUND")) {
    const details = error.details; // typed as CommandNotFoundErrorDetails
}
```

### Module & Export Patterns

- All packages use **ESM** (`"type": "module"`)
- Barrel exports through `src/index.ts` — group by category with section comments
- Separate `export type` from value exports in barrel files
- Use `export function` / `export const` at declaration site (no default exports)
- Build output targets **Bun** runtime via bunup

### Code Organization

- **Section dividers**: Use the `────` comment pattern for major sections within files
  ```ts
  // ────────────────────────────────────────────────────────────────────────────
  // Section Name — Brief description
  // ────────────────────────────────────────────────────────────────────────────
  ```
- **JSDoc**: Use `@example`, `@param`, `@returns`, `@throws` tags on public APIs
- **Inline comments**: Explain *why*, not *what* — especially for non-obvious type assertions
- Keep functions small and focused; extract helpers as `function` declarations (not arrow)

### Type Patterns

- Use `as const satisfies` for defining arg/flag definitions with full type inference
- Use `readonly` for immutable data (commands are frozen via `Object.freeze`)
- Compile-time validation types (e.g. `CheckVariadicArgs`, `CheckFlagAliasCollisions`) resolve to `unknown` on success or error tuples on failure
- Prefer structural typing — use `AnyCommand` (interface with method syntax) for type-erased command references to leverage bivariant checking

### Testing Patterns

- Console output capture: mock `console.log`/`console.error`/`console.warn` in `beforeEach`, restore in `afterEach`
- Use the `runCommand` helper from `tests/helpers.ts` for integration tests — it captures stdout/stderr/exitCode
- Type-level tests use `Expect<Equal<A, B>>` utility types (compile-time only)
- Test error cases with `expect(fn).rejects.toThrow("message")` or try/catch with `expect.unreachable()`
