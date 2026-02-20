# AGENTS.md — Crust CLI Framework

## Project Overview

Crust is a Bun-native, TypeScript-first CLI framework. **Turborepo** monorepo, **Bun** package manager/runtime, **Biome** linter/formatter, **bunup** build tool.

### Monorepo Packages

| Package            | Path                    | Description                                                        |
| ------------------ | ----------------------- | ------------------------------------------------------------------ |
| `@crustjs/core`    | `packages/core`         | Core: command definition, arg parsing, routing, plugins, errors    |
| `@crustjs/plugins` | `packages/plugins`      | Official plugins: help, version, autocomplete                      |
| `@crustjs/crust`   | `packages/crust`        | The `crust` CLI binary (self-hosted with `@crustjs/core`)          |
| `create-crust`     | `packages/create-crust` | Project scaffolding tool                                           |
| `@crustjs/config`  | `packages/config`       | Shared TypeScript config (`tsconfig.base.json`)                    |
| docs               | `apps/docs`             | Documentation site (Vite + TanStack Router, deployed to Cloudflare)|

## Build / Lint / Test Commands

```sh
# ── Monorepo root ────────────────────────────────────────────────────────
bun install                          # Install all deps
bun run build                        # Build all packages (turbo)
bun run check                        # Biome lint + format check
bun run check:types                  # TypeScript type-check all packages
bun run test                         # Run all tests across packages

# ── Single package (turbo filter from root) ──────────────────────────────
bun run build --filter=@crustjs/core
bun run test --filter=@crustjs/core

# ── Single package (from package dir) ────────────────────────────────────
cd packages/core && bun test                                        # All tests
cd packages/core && bun test src/parser.test.ts                     # Single file
cd packages/core && bun test --test-name-pattern "executes run"     # By name

# ── Dev mode ─────────────────────────────────────────────────────────────
bun run dev                          # Watch all packages
cd packages/crust && bun run dev     # Run crust CLI in dev mode
```

### Test Framework & Conventions

- Tests use **bun:test**: `import { describe, expect, it, beforeEach, afterEach } from "bun:test"`
- **Unit tests**: co-located — `src/foo.test.ts` beside `src/foo.ts`
- **Integration/smoke tests**: in `tests/` directory
- **Test helpers**: `tests/helpers.ts` — `runCommand` captures `{ stdout, stderr, exitCode }`
- **Console mocking**: save original in `beforeEach`, mock to capture output, restore in `afterEach`
- **Type-level tests**: `Expect<Equal<A, B>>` utilities (compile-time only, no runtime assertion needed)
- **Error tests**: `expect(fn).rejects.toThrow("msg")` or try/catch with `expect.unreachable()`
- **Test fixture factories**: helper functions that build commands dynamically for parameterized tests

## Code Style Guidelines

### Biome (Formatter & Linter)

- **Indent**: Tabs — **Quotes**: Double — **Imports**: Auto-organized
- Run `bun run check` before committing. Biome is the single source of truth (no Prettier/ESLint).
- **`biome-ignore` directives**: suppress only with a justification comment, e.g.:

  ```ts
  // biome-ignore lint/complexity/noBannedTypes: empty base case for recursive intersection
  ```

### TypeScript Configuration

Strict mode with notable settings: `strict`, `noFallthroughCasesInSwitch`, `noUncheckedIndexedAccess` (indexed access returns `T | undefined`), `noImplicitOverride`, `verbatimModuleSyntax` (enforces `import type`), `target: ESNext`, `module: Preserve`.

### Imports

- **Relative imports**: always use `.ts` extensions — `import { foo } from "./bar.ts"`
- **Type-only imports**: `import type { X } from "./types.ts"` (enforced by `verbatimModuleSyntax`)
- **Workspace imports**: package names — `import { defineCommand } from "@crustjs/core"`
- **Node built-ins**: `node:` prefix — `import { resolve } from "node:path"`
- Let Biome handle import ordering

### Naming Conventions

- **Files**: `camelCase.ts`, `camelCase.test.ts`
- **Types/Interfaces**: `PascalCase` — `CommandDef`, `FlagsDef`, `ParseResult`
- **Type parameters**: Short uppercase — `A extends ArgsDef`, `F extends FlagsDef`
- **Functions/constants**: `camelCase` — `defineCommand`, `parseArgs`, `helpPlugin`
- **Interfaces** for object shapes; **`type`** for unions, mapped types, utilities
- **Plugin factories**: `camelCase` functions returning `CrustPlugin` — `helpPlugin()`, `versionPlugin()`
- **No default exports** — use `export function` / `export const` at declaration site

### Error Handling

- `CrustError` with typed codes: `DEFINITION`, `VALIDATION`, `PARSE`, `EXECUTION`, `COMMAND_NOT_FOUND`
- Framework errors: `throw new CrustError("VALIDATION", "message")`
- User command errors: `throw new Error("message")`
- Chain causes: `.withCause(originalError)`
- Type-narrow: `error.is("COMMAND_NOT_FOUND")` returns typed `.details`
- `runCommand` wraps non-CrustError into `CrustError("EXECUTION", ...)`
- `runMain` is the top-level entry; catches all errors and sets `process.exitCode = 1`

### Module & Export Patterns

- All packages are **ESM** (`"type": "module"`)
- Barrel exports in `src/index.ts` — group by category with section comments
- Separate `export type` from value exports in barrel files
- Build targets **Bun** runtime via bunup

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

### Type Patterns

- `as const satisfies` for arg/flag definitions with full type inference
- `readonly` fields on immutable data; `Object.freeze()` on constructed commands
- Compile-time validation types (`CheckVariadicArgs`, `CheckFlagAliasCollisions`) resolve to `unknown` on success, error tuples on failure
- `AnyCommand` (interface with method syntax) for type-erased references (bivariant checking)
- `NoInfer<T>` on callback parameters to force inference from data properties, not callbacks
- Type guard on `.filter()`: `filter((x): x is NonNullable<typeof x> => Boolean(x))`
- `Simplify<T>` utility to flatten intersections for readable hover types
