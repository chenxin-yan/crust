# Progress Log

---

## Task: Establish a Standard Schema-first core in @crustjs/validate with a new /standard entrypoint and shared runtime contracts

### Completed

- Added `@standard-schema/spec` v1.1.0 as a runtime dependency to `@crustjs/validate`
- Created `packages/validate/src/standard/` module with types, validation core, and barrel index
- Added `./standard` export path in package.json and bunup build config
- Implemented `isStandardSchema()` type guard for runtime Standard Schema v1 detection
- Implemented `normalizeStandardPath()` to resolve Standard Schema path segments (bare `PropertyKey` and `{ key: PropertyKey }` objects) to `PropertyKey[]`
- Implemented `normalizeStandardIssues()` to convert Standard Schema issues to canonical `ValidationIssue` objects with optional path prefix support
- Implemented `validateStandard()` (async) and `validateStandardSync()` execution helpers that run `~standard.validate` and normalize results
- Defined `ValidationResult<T>` discriminated union (`ValidationSuccess<T>` | `ValidationFailure`) with `ok` discriminant
- Exported `success()` and `failure()` result constructors
- Exported type aliases `StandardSchema`, `InferInput`, `InferOutput` for ergonomic Standard Schema type usage
- Added 55+ unit tests covering type guards, path normalization, issue normalization, result constructors, async/sync validation, prefix handling, and edge cases
- Updated scaffold test to verify standard entrypoint importability and exported API surface
- All 168 package tests pass, monorepo type checks clean, biome lint clean

### Files Changed

- `packages/validate/package.json` — added `@standard-schema/spec` dependency and `./standard` export
- `packages/validate/bunup.config.ts` — added `src/standard/index.ts` entry
- `packages/validate/src/standard/types.ts` — new: StandardSchema type aliases, ValidationResult union
- `packages/validate/src/standard/validate.ts` — new: type guard, path/issue normalization, schema execution
- `packages/validate/src/standard/index.ts` — new: barrel exports for standard entrypoint
- `packages/validate/src/standard/validate.test.ts` — new: comprehensive unit tests
- `packages/validate/src/scaffold.test.ts` — extended with standard entrypoint test

### Decisions

- `ValidationResult<T>` uses `ok: true/false` discriminant (consistent with existing `middleware.ts` pattern) rather than checking `issues` truthiness like raw Standard Schema results
- Both `ValidationSuccess` and `ValidationFailure` carry optional inverse fields (`issues?: undefined` / `value?: undefined`) to aid type narrowing
- `validateStandard()` always awaits since Standard Schema spec allows sync or async returns; `validateStandardSync()` provides an explicit sync path that throws on Promise returns
- `normalizeStandardPath()` is exported separately for consumers who need path normalization without full validation
- `@standard-schema/spec` is a real dependency (not peer) since it's the core contract, not a user-supplied library

### Notes for Future Agent

- The `validateStandard`/`validateStandardSync` functions are the foundation for Task 2 (refactoring command validation) — they can replace the provider-specific `validateValue` functions in `withZod.ts` and `withEffect.ts`
- The `normalizeStandardIssues` function with prefix support maps directly to how `middleware.ts` prefixes paths like `["flags", "name"]` or `["args", 0]`
- The `ValidationResult` type from `standard/types.ts` is similar but distinct from the `ValidationResult` in `middleware.ts` — Task 2 should unify these
- Both Zod v4 and Effect Schema implement Standard Schema v1, so the standard core can be the single execution path for both providers
- The `success()`/`failure()` helpers will be useful for store adapters (Task 6) and prompt adapters (Task 3)

---

## Task: Refactor command validation runtime to use the Standard Schema core while keeping provider-specific command DSL ergonomics

### Completed

- Refactored `withZod.ts` to delegate schema execution to `validateStandard()` from the standard core, removing direct `zod/v4/core` `safeParseAsync` dependency and manual issue normalization
- Refactored `withEffect.ts` to delegate schema execution to `validateStandard()` from the standard core via `standardSchemaV1()` wrapper, removing direct `effect/Effect`, `effect/Either`, `effect/ParseResult`, and `effect/Schema.decodeUnknown` dependencies
- Unified `ValidationResult` type: `middleware.ts` now re-exports `ValidationResult` from `standard/types.ts` instead of defining its own duplicate type
- Removed duplicated provider-specific issue mapping logic (`normalizeIssues` calls with manual prefix prepending) from both `withZod.ts` and `withEffect.ts` — all issue normalization now flows through `normalizeStandardIssues()` in the standard core
- Updated `withEffect` docstring to reflect that async schemas are now supported (previously was sync-only due to `Effect.runSync`)
- All 168 existing tests pass unchanged, monorepo type checks clean, biome lint clean

### Files Changed

- `packages/validate/src/middleware.ts` — replaced local `ValidationResult` type with re-export from `standard/types.ts`
- `packages/validate/src/zod/withZod.ts` — replaced Zod-specific `validateValue` with inline `validateStandard()` call, removed `safeParseAsync` and `normalizeIssues` imports
- `packages/validate/src/effect/withEffect.ts` — replaced Effect-specific `validateValue` with inline `validateStandard()` + `standardSchemaV1()` call, removed all Effect runtime imports (`Effect`, `Either`, `ParseResult`, `decodeUnknown`)

### Decisions

- **Zod schemas are Standard Schema-native**: Zod v4 schemas already implement `~standard.validate` directly, so `validateStandard()` can consume them without any wrapper
- **Effect schemas need `standardSchemaV1()` wrapper**: Effect Schema v3.19 does not implement `~standard` on schema objects natively but provides `Schema.standardSchemaV1()` to create a compatible wrapper — this is called at validation time in `withEffect`
- **No backward-compat break**: The public API surface (`withZod`, `withEffect`, `arg`, `flag`) remains identical. The refactoring is purely internal delegation changes
- **Unified `ValidationResult`**: Rather than maintaining two identical types, `middleware.ts` now re-exports from `standard/types.ts`. The standard version carries `readonly issues` and optional inverse fields (`issues?: undefined` on success, `value?: undefined` on failure) which is a superset of the old middleware type
- **`withEffect` is no longer sync-only**: Since `validateStandard()` always awaits, Effect schemas that return async results (e.g., via `Schema.filterEffect`) now work correctly instead of throwing `AsyncFiberException`

### Notes for Future Agent

- The `normalizeIssues` function in `validation.ts` is no longer used by any provider — it's only referenced in its own test file. It may be removable or kept for external consumers
- The `ValidateValueFn` type in `middleware.ts` now accepts `ValidationResult` from `standard/types.ts` which includes optional `value?: undefined` / `issues?: undefined` fields — this is structurally compatible with how `buildValidatedRunner` consumes results
- Effect's `standardSchemaV1()` returns a function object (not a plain object) with `~standard` interface. The `as StandardSchema` cast is safe because it matches the structural contract
- For prompt adapters (Task 3) and store adapters (Task 6), the same `validateStandard()` function can be reused directly — no need to go through provider-specific validation paths
- The `formatPath`/`normalizeIssues`/`renderBulletList`/`throwValidationError` utilities in `validation.ts` are still used by `middleware.ts` for error rendering — they remain unchanged

---

## Task: Add first-class prompt validation adapters in @crustjs/validate/standard with consistent error rendering and async support

### Completed

- Implemented `promptValidator()` function that converts a Standard Schema into a `ValidateFn<T>`-compatible function for `@crustjs/prompts`
- The adapter returns `true` on valid input and a `string` error message on invalid input, matching the `ValidateFn<T>` contract exactly
- Supports both sync and async schemas transparently via `validateStandard()` — always returns `Promise<true | string>`
- Implemented configurable `PromptErrorStrategy` with two modes:
  - `"first"` (default) — returns only the first issue's message, with path prefix when available
  - `"all"` — renders all issues as a multi-line bullet list using `renderBulletList()` from the shared validation core
- Exported `promptValidator`, `PromptErrorStrategy`, and `PromptValidatorOptions` from `@crustjs/validate/standard`
- Added 26 focused unit tests covering: success/failure for sync and async schemas, both error strategies, edge cases (empty issues, successive calls, PathSegment paths, null/undefined values), and ValidateFn contract compatibility
- Updated scaffold test to verify `promptValidator` is exported from the standard entrypoint
- All 194 package tests pass, monorepo type checks clean, biome lint clean

### Files Changed

- `packages/validate/src/standard/prompt.ts` — new: prompt adapter implementation with `promptValidator()`, `PromptErrorStrategy`, `PromptValidatorOptions`
- `packages/validate/src/standard/prompt.test.ts` — new: comprehensive unit tests for prompt adapter
- `packages/validate/src/standard/index.ts` — added exports for prompt adapter types and function
- `packages/validate/src/scaffold.test.ts` — extended to verify `promptValidator` export

### Decisions

- **No dependency on `@crustjs/prompts`**: The adapter produces functions matching the `ValidateFn<T>` contract (`(value: T) => true | string | Promise<true | string>`) without importing from `@crustjs/prompts`. This keeps package boundaries clean.
- **Always async**: `promptValidator()` always returns `Promise<true | string>` since `validateStandard()` always awaits. The `@crustjs/prompts` `ValidateFn<T>` contract already supports async return values.
- **"first" as default strategy**: Most prompt inputs are single fields where showing one error at a time is the best UX. The `"all"` strategy is available for complex schemas.
- **Path-prefixed messages in "first" strategy**: When the first issue has a path (e.g. from object schemas), the error message includes the path context (e.g. `"name: Required"`) for clarity.
- **`renderBulletList` reuse**: The "all" strategy delegates to the shared `renderBulletList()` from `validation.ts` for consistent multi-issue formatting across command and prompt targets.

### Notes for Future Agent

- Task 4 (typed prompt parsing helpers) is complementary — it focuses on parsing prompt answers into schema output types, while this task focuses on validation functions. They use different parts of the `validateStandard()` result.
- The `promptValidator` function only validates — it does NOT return the transformed schema output. Task 4's parsing helpers will address that gap for typed output workflows.
- For provider wrapper exports in zod/effect entrypoints (mentioned in Task 4 subtasks), `promptValidator` can be re-exported directly since it already works with any Standard Schema. Zod schemas are natively compatible; Effect schemas need `standardSchemaV1()` wrapping at the caller level.
- The `renderBulletList` function from `validation.ts` is now shared between command validation error rendering (via `middleware.ts`) and prompt "all" strategy. Any changes to its format will affect both surfaces.
