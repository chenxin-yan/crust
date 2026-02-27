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

---

## Task: Add typed prompt parsing helpers for schema-transformed prompt outputs to improve end-to-end DX

### Completed

- Implemented `parsePromptValue()` (async) and `parsePromptValueSync()` (sync) in `standard/prompt.ts` that validate a raw prompt answer through a Standard Schema and return the typed output value
- Both functions return `InferOutput<S>` — preserving coercions, defaults, and type refinements applied by the schema
- On validation failure, both throw `CrustError("VALIDATION")` with normalized issues (same error shape as command validation)
- `parsePromptValueSync()` throws `TypeError` if the schema returns a Promise, matching `validateStandardSync()` behavior
- Re-exported `promptValidator`, `parsePromptValue`, `parsePromptValueSync`, `PromptErrorStrategy`, and `PromptValidatorOptions` from both `@crustjs/validate/zod` and `@crustjs/validate/effect` entrypoints
- Added 34 new unit tests covering: passthrough values, sync/async transforms, coercion (string→number), default values, optional schemas, object/array transforms, CrustError shape with structured issues, TypeError for async schemas in sync path, null handling, and edge cases
- Updated scaffold tests to verify `parsePromptValue` and `parsePromptValueSync` exports from all three entrypoints (standard, zod, effect)
- All 228 package tests pass, monorepo type checks clean, biome lint clean

### Files Changed

- `packages/validate/src/standard/prompt.ts` — added `parsePromptValue()` and `parsePromptValueSync()` functions
- `packages/validate/src/standard/index.ts` — added exports for `parsePromptValue` and `parsePromptValueSync`
- `packages/validate/src/zod/index.ts` — added re-exports for prompt adapter types and functions from standard
- `packages/validate/src/effect/index.ts` — added re-exports for prompt adapter types and functions from standard
- `packages/validate/src/standard/prompt.test.ts` — added 34 tests for parsing helpers
- `packages/validate/src/scaffold.test.ts` — extended with export checks for zod/effect entrypoints

### Decisions

- **Throw on failure, not return errors**: Parsing helpers throw `CrustError("VALIDATION")` rather than returning a result union. This matches the command validation pattern (`throwValidationError`) and fits the "parse or fail" workflow where callers want the typed value directly.
- **Error prefix "Prompt validation failed"**: Distinguishes prompt parsing errors from command validation errors ("withZod: validation failed") in error messages, while using the same `CrustError` code and issue structure.
- **Direct re-export from standard**: Zod and Effect entrypoints re-export `parsePromptValue`/`parsePromptValueSync`/`promptValidator` directly from `../standard/prompt.ts` rather than creating wrapper functions. Since these functions accept any Standard Schema, no provider-specific wrapping is needed. Effect schemas require `Schema.standardSchemaV1()` at the caller level — this is documented in the export comment.
- **No `parsePromptValue` overload for prompt-integrated workflows**: Kept the API surface minimal with a single `parsePromptValue(schema, value)` signature. Prompt-integrated workflows can compose `promptValidator` for validation + `parsePromptValue` for typed output.

### Notes for Future Agent

- `parsePromptValue` and `promptValidator` are complementary: use `promptValidator` in prompt `validate` options (returns `true | string`), then `parsePromptValue` after the prompt resolves to get the typed output.
- For Effect schemas, callers must wrap with `Schema.standardSchemaV1()` before passing to any prompt adapter function. This is consistent with how `withEffect.ts` handles Effect schemas internally.
- The store adapter (Task 6) can follow the same pattern: use `validateStandard()` for schema execution and `throwValidationError()` for failure handling.
- The `throwValidationError` function from `validation.ts` is now used by both command middleware and prompt parsing helpers — it's the canonical way to throw `CrustError("VALIDATION")` with structured issues.

---

## Task: Introduce store validation contract in @crustjs/store and enforce strict validation on both read and write paths by default

### Completed

- Added `StoreValidator<T>` type contract to `types.ts` — a provider-agnostic function type `(value: unknown) => StoreValidatorResult<T> | Promise<StoreValidatorResult<T>>` with discriminated `ok: true/false` result union
- Added `StoreValidatorSuccess<T>`, `StoreValidatorFailure`, `StoreValidatorIssue`, and `StoreValidatorResult<T>` types to `types.ts`
- Added optional `validator` field to `CreateStoreOptions<F>` that accepts a `StoreValidator<InferStoreConfig<F>>`
- Added `VALIDATION` error code to `CrustStoreError` with `ValidationErrorDetails` (operation + structured issues)
- Added `StoreValidationIssue` type to `errors.ts` for the error details payload (compatible with but independent from `@crustjs/validate`'s `ValidationIssue`)
- Applied validator execution in `store.write()` — validates before persistence, persists the (possibly transformed) validated value
- Applied validator execution in `store.read()` — validates after defaults merge, returns the validated value
- Applied validator execution in `store.update()` — reads raw (no validation on read phase), applies updater, validates updated result, persists
- `store.reset()` does not invoke the validator (no config to validate)
- Added 40+ new tests covering: write validation (pass/fail/async/transform/error message format), read validation (defaults/persisted/async/transform/root-level errors), update validation (pass/fail/no-persist-on-fail/transform/single-invocation check), reset (no validator call), backward compatibility (no validator option), and full lifecycle integration
- Extended error tests with VALIDATION construction and `.is("VALIDATION")` narrowing tests
- All 156 store tests pass, monorepo type checks clean, biome lint clean

### Files Changed

- `packages/store/src/types.ts` — added `StoreValidator<T>`, `StoreValidatorSuccess<T>`, `StoreValidatorFailure`, `StoreValidatorIssue`, `StoreValidatorResult<T>` types; added `validator` option to `CreateStoreOptions`; updated `Store` interface JSDoc with VALIDATION throws
- `packages/store/src/errors.ts` — added `StoreValidationIssue`, `ValidationErrorDetails` types; added `VALIDATION` to `StoreErrorDetailsMap`; updated JSDoc
- `packages/store/src/store.ts` — added `runValidator()` helper, `readRaw()` internal function; integrated validator into `read()`, `write()`, `update()` paths
- `packages/store/src/index.ts` — added exports for `StoreValidationIssue`, `ValidationErrorDetails`, `StoreValidator`, `StoreValidatorSuccess`, `StoreValidatorFailure`, `StoreValidatorIssue`, `StoreValidatorResult`
- `packages/store/src/store.test.ts` — added 40+ validation tests across write/read/update/reset/backward-compat/lifecycle
- `packages/store/src/errors.test.ts` — added VALIDATION error construction and type narrowing tests

### Decisions

- **Provider-agnostic validator contract**: `StoreValidator<T>` is defined entirely in `@crustjs/store` with no dependency on `@crustjs/validate`, Standard Schema, Zod, or Effect. The validator accepts `unknown` and returns a discriminated result, matching the `ValidationResult` pattern from the standard core but as an independent type.
- **`StoreValidatorIssue` vs `StoreValidationIssue`**: Two similar but distinct types — `StoreValidatorIssue` is the contract type used in `StoreValidatorResult` (validator output), while `StoreValidationIssue` is used in `CrustStoreError` details (error payload). They have the same shape but serve different roles: one is the validator's API contract, the other is the error's structured data.
- **Strict by default**: Validation runs on every `read()`, `write()`, and `update()` call when a validator is provided. There is no `validate: false` escape hatch — per SPEC constraints, invalid config must fail loudly.
- **Transformed values flow through**: If a validator's success result carries a transformed `value`, that transformed value is what gets persisted (on write/update) or returned (on read). This supports schema coercion and normalization.
- **Update reads raw, validates once**: `update()` reads the current config without validation (via internal `readRaw()`), applies the updater, then validates only the updated result. This avoids double validation and means an update can work even if the currently persisted config is invalid — as long as the updated result is valid.
- **`CrustStoreError("VALIDATION")` vs `CrustError("VALIDATION")`**: Store uses its own error class rather than the `@crustjs/validate` `CrustError`. This keeps package boundaries clean — consumers catch `CrustStoreError` and narrow with `.is("VALIDATION")`. The error message follows the same bullet-list format used by command/prompt validation for consistency.
- **Reset doesn't validate**: `reset()` deletes the persisted file — there's no config object to validate.

### Notes for Future Agent

- Task 6 (store adapters in `@crustjs/validate`) should create functions that return `StoreValidator<T>` from Standard Schema / Zod / Effect schemas. The adapter should use `validateStandard()` or `validateStandardSync()` from `standard/validate.ts` to execute the schema and map the `ValidationResult` to `StoreValidatorResult`. The `StoreValidatorIssue` shape (`{ message, path }`) is identical to `ValidationIssue`, so the mapping is straightforward.
- For Effect schemas, the store adapter should wrap with `standardSchemaV1()` before passing to `validateStandard()`, consistent with how `withEffect.ts` and prompt adapters handle Effect.
- The `StoreValidator<T>` contract supports both sync and async validators — `createStore` always awaits the result. If a sync-only store is ever needed, a sync variant would require changes.
- The `operation` field in `ValidationErrorDetails` distinguishes where validation failed: `"read"`, `"write"`, or `"update"`. This helps consumers differentiate between corrupt persisted config (read) vs bad input (write/update).
- Backward compatibility is preserved: stores without `validator` option behave identically to before.

---

## Task: Implement Standard Schema store adapters in @crustjs/validate and expose provider wrappers for zod/effect

### Completed

- Implemented `storeValidator()` (async) and `storeValidatorSync()` (sync) in `standard/store.ts` that convert a Standard Schema into `StoreValidator<T>`-compatible functions
- Both functions delegate to `validateStandard()` / `validateStandardSync()` from the standard core for schema execution and issue normalization
- The returned validator functions accept `unknown` and return a discriminated `{ ok: true, value }` / `{ ok: false, issues }` result structurally compatible with `StoreValidatorResult<T>`
- Defined internal `StoreValidatorResultLike<T>` structural type to match `StoreValidatorResult<T>` without importing from `@crustjs/store` (keeps package boundaries clean)
- Exported `storeValidator` and `storeValidatorSync` from `@crustjs/validate/standard`, `@crustjs/validate/zod`, and `@crustjs/validate/effect` entrypoints
- Zod and Effect entrypoints re-export directly from `standard/store.ts` — no provider-specific wrapping needed since the functions accept any Standard Schema
- Added 27 new unit tests covering: valid passthrough, transformed output, async schemas, invalid configs with single/multiple/nested/array/root-level/PathSegment issues, null/undefined input, successive calls, empty issues, sync TypeError on async schema, and structural compatibility assertions
- Updated scaffold tests to verify `storeValidator` and `storeValidatorSync` exports from all three entrypoints
- All 255 validate tests pass, 156 store tests pass, monorepo type checks clean, biome lint clean

### Files Changed

- `packages/validate/src/standard/store.ts` — new: `storeValidator()`, `storeValidatorSync()`, `StoreValidatorResultLike<T>` type
- `packages/validate/src/standard/store.test.ts` — new: 27 unit tests for store adapter
- `packages/validate/src/standard/index.ts` — added exports for `storeValidator`, `storeValidatorSync`
- `packages/validate/src/zod/index.ts` — added re-exports for store adapters from standard
- `packages/validate/src/effect/index.ts` — added re-exports for store adapters from standard
- `packages/validate/src/scaffold.test.ts` — extended with `storeValidator`/`storeValidatorSync` export checks for all entrypoints

### Decisions

- **No dependency on `@crustjs/store`**: The adapter uses a structural `StoreValidatorResultLike<T>` type that matches `StoreValidatorResult<T>` without importing from `@crustjs/store`. This keeps the package boundary clean — `@crustjs/validate` never imports from `@crustjs/store`.
- **No mapping needed**: `ValidationResult<T>` from the standard core is structurally identical to `StoreValidatorResult<T>` — both use `{ ok: true, value: T }` | `{ ok: false, issues: { message, path }[] }`. The adapter simply returns the `validateStandard()` result directly.
- **Async and sync variants**: `storeValidator()` (async, always safe) and `storeValidatorSync()` (sync, throws TypeError on async schemas) mirror the pattern established by `validateStandard()`/`validateStandardSync()` and `parsePromptValue()`/`parsePromptValueSync()`.
- **Direct re-export from standard**: Zod and Effect entrypoints re-export directly — no wrapper functions needed since the adapters accept any Standard Schema. Effect schemas need `Schema.standardSchemaV1()` wrapping at the caller level, consistent with prompt adapters.

### Notes for Future Agent

- The store adapter is now complete. `createStore({ validator: storeValidator(schema) })` works for any Standard Schema-compatible library.
- For Effect schemas, callers must wrap: `storeValidator(Schema.standardSchemaV1(effectSchema))`.
- Task 7 (explicit parser metadata) is independent and can proceed without store adapter changes.
- Task 8 (documentation) should include store adapter usage examples showing the `validator` option with Zod and Effect schemas.
- Task 9 (cross-package integration tests) should exercise a shared schema across command, prompt, and store targets — the store adapter is now ready for this.

---

## Task: Unify command arg/flag schema DX by adding explicit parser metadata fallback when schema introspection is ambiguous

### Completed

- Defined `ParserMeta` interface in both `zod/types.ts` and `effect/types.ts` with `type`, `description`, and `required` override fields
- Extended `ArgOptions` and `FlagOptions` to inherit from `ParserMeta` in both providers
- Exported `ParserMeta` type from `@crustjs/validate/zod` and `@crustjs/validate/effect` entrypoints
- Refactored schema introspection in both providers to use `tryResolveInputShape()` (returns `undefined` instead of throwing) for graceful fallback
- Removed now-unused `resolveInputShape()` functions from both `zod/schema.ts` and `effect/schema.ts`
- Implemented metadata resolution with precedence: explicit > inferred for all three fields
- Implemented conflict detection: if explicit metadata is provided AND schema introspection succeeds with a conflicting value, a `DEFINITION` error is thrown with a clear message
- Description overrides are additive (no conflict check) — explicit always wins
- Updated `arg()` and `flag()` docstrings in both providers to document the explicit metadata override pattern and precedence rules
- Added 24 new Zod tests covering: explicit description override, matching/conflicting type overrides, required/optional conflict detection, combined metadata, end-to-end precedence validation
- Added 24 new Effect tests covering the same scenarios adapted for Effect schema API (annotations, UndefinedOr patterns)
- Added precedence documentation tests in both providers
- All 303 validate tests pass, 156 store tests pass, monorepo type checks clean, biome lint clean

### Files Changed

- `packages/validate/src/zod/types.ts` — added `ParserMeta` interface, `ArgOptions` and `FlagOptions` now extend `ParserMeta`
- `packages/validate/src/effect/types.ts` — added `ParserMeta` interface, `ArgOptions` and `FlagOptions` now extend `ParserMeta`
- `packages/validate/src/zod/schema.ts` — refactored to `tryResolveInputShape()`, removed unused `resolveInputShape()`, `arg()` and `flag()` now support explicit metadata with conflict detection
- `packages/validate/src/effect/schema.ts` — refactored to `tryResolveInputShape()`, removed unused `resolveInputShape()`, `arg()` and `flag()` now support explicit metadata with conflict detection
- `packages/validate/src/zod/index.ts` — added `ParserMeta` type export
- `packages/validate/src/effect/index.ts` — added `ParserMeta` type export
- `packages/validate/src/zod/withZod.test.ts` — added 24 explicit metadata override tests
- `packages/validate/src/effect/withEffect.test.ts` — added 24 explicit metadata override tests

### Decisions

- **Conflict detection over silent override**: When both explicit metadata and schema introspection agree, the explicit value is used. When they conflict, a `DEFINITION` error is thrown rather than silently overriding. This prevents latent bugs where the schema changes but the explicit metadata becomes stale.
- **Description has no conflict check**: Unlike `type` and `required`, descriptions are always overridable without conflict detection. This is because descriptions are purely informational and having an explicit description that differs from a schema annotation is a legitimate use case (e.g., shorter help text for CLI vs verbose schema documentation).
- **`tryResolveInputShape` replaces `resolveInputShape`**: The old throwing version is removed since `arg()` and `flag()` now handle the fallback logic directly. This avoids double error handling.
- **Effect `tryResolveInputShape` does not catch all errors**: Structural definition errors (e.g., tuples with fixed elements) still propagate as `CrustError("DEFINITION")` since those are definite user mistakes, not ambiguity that metadata overrides should solve.
- **`required: false` means optional in options**: The `ParserMeta.required` field uses `boolean` (not `true | undefined`) to allow explicitly marking as both required and optional. This differs from the core `ArgDef.required` which only accepts `true`.

### Notes for Future Agent

- Task 8 (documentation) should include examples of the explicit metadata pattern: `arg("input", complexSchema, { type: "string", description: "..." })`.
- The `ParserMeta` interface is identical in both Zod and Effect types files. If a shared types module is ever created, these could be unified.
- For the cross-package integration tests (Task 9), note that the explicit metadata feature only affects definition-time — it doesn't change validation runtime behavior. The middleware (`buildValidatedRunner`) works the same regardless of how metadata was derived.
- The test error message pattern `/explicit type "..." conflicts with schema-inferred type "..."/` is consistent across both providers and can be used in integration test assertions if needed.

---

## Task: Publish unified API surface and documentation for standard, zod, and effect entrypoints across command/prompt/store workflows

### Completed

- Rewrote `packages/validate/README.md` with Standard Schema-first architecture overview, target matrix (command/prompt/store), all four entrypoint descriptions, and comprehensive usage examples
- Added documentation for prompt validation (`promptValidator`, `parsePromptValue`, error strategies), store validation (`storeValidator`, `storeValidatorSync`), and explicit parser metadata (`ParserMeta` with `type`/`description`/`required` overrides)
- Added Effect schema wrapping examples (`Schema.standardSchemaV1()`) for prompt and store targets
- Added complete type export documentation for all four entrypoints (root, standard, zod, effect)
- Updated `packages/store/README.md`: added `validator` option to options table, added full "Validation" section with `@crustjs/validate` integration examples, custom validator pattern, validation behavior docs, and `VALIDATION` error catching examples
- Updated store error table to include `VALIDATION` code
- Updated store Types section with all validation-related types (`StoreValidator`, `StoreValidatorResult`, `StoreValidatorSuccess`, `StoreValidatorFailure`, `StoreValidatorIssue`, `StoreValidationIssue`, `ValidationErrorDetails`)
- Replaced "Built-in validation — will be added later" non-goal with "Automatic migration of invalid persisted config" (validation is now implemented)
- Enhanced `scaffold.test.ts` with exact API surface assertions for all three entrypoints (sorted export name arrays)
- Added `arg`/`flag`/`withZod`/`withEffect` function checks to zod/effect entrypoint tests
- Added reference identity tests proving prompt and store adapters are the same function across entrypoints (re-exports, not copies)
- Added runtime API surface test to `packages/store/src/index.test.ts`
- All 308 validate tests pass, 157 store tests pass, monorepo type checks clean, biome lint clean

### Files Changed

- `packages/validate/README.md` — rewritten with Standard Schema-first architecture, target matrix, all-target examples, ParserMeta docs, type export reference
- `packages/store/README.md` — added validation section, updated options table/error table/types table/v1 scope
- `packages/validate/src/scaffold.test.ts` — enhanced with exact export surface tests, function reference identity tests, arg/flag/withZod/withEffect checks
- `packages/store/src/index.test.ts` — added runtime API surface export test

### Decisions

- **README rewrite vs incremental edit**: The validate README was rewritten from scratch rather than incrementally patched. The old README only covered command validation; the new one covers all three targets and the Standard Schema architecture, making an incremental approach fragile.
- **Target matrix table**: Added a target matrix early in the README showing which APIs are available from which entrypoints, with a footnote about Effect `standardSchemaV1()` wrapping.
- **Exact export surface tests**: Scaffold tests now assert sorted arrays of export names rather than just checking individual functions exist. This catches accidental export additions/removals.
- **Reference identity tests**: Added tests proving `zod.promptValidator === standard.promptValidator` and similar. This documents and enforces the re-export architecture (not wrapper functions).
- **Store README validation section**: Placed before the existing "Error Handling" section so readers encounter validation patterns before error handling details.
- **No separate API reference docs**: All API documentation lives in README.md files per package convention. Type exports are documented with import examples.

### Notes for Future Agent

- Task 9 (cross-package integration tests) is the final remaining task. It should exercise one shared schema across command, prompt, and store validation targets and assert consistent issue paths, message rendering, and error behavior.
- The scaffold tests now provide a safety net for the public API surface — if any export is added or removed, the exact-match test will fail.
- The store README examples use `@crustjs/validate/zod` and `@crustjs/validate/effect` import paths, matching the documented entrypoints.
- The validate README includes a "Standard Schema directly" section showing the standard entrypoint for provider-agnostic usage — this is relevant for libraries building on top of `@crustjs/validate`.
