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
