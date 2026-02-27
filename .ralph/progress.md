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
