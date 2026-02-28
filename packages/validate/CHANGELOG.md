# @crustjs/validate

## 0.0.7

### Patch Changes

- e9a591a: Redesign store to use fields-based API with per-field validation

  - Replaced `defaults` option with `fields` containing `type`, `default` (optional), and `validate` (optional)
  - Fields without `default` are typed as `T | undefined` and skip validation when undefined
  - Fields with `default` are typed as their primitive type (guaranteed present)
  - Removed top-level `validator` option from `CreateStoreOptions`
  - `patch` now uses `Partial<T>` (shallow) instead of `DeepPartial<T>`
  - Validation runs on `read`, `write`, `update`, and `patch` operations
  - Per-field validation collects all issues before throwing single `CrustStoreError("VALIDATION")`
  - Renamed `storeValidator`/`storeValidatorSync` to `field`/`fieldSync` for less verbose DX

## 0.0.6

### Patch Changes

- 46a4107: Redesign validate interfaces around Standard Schema v1. Rename `withZod`/`withEffect` to `commandValidator`. Add `@crustjs/validate/standard` entrypoint with provider-agnostic prompt and store validation adapters (`promptValidator`, `parsePromptValue`, `storeValidator`). Re-export prompt/store adapters from `/zod` and `/effect` entrypoints. Replace store `validate` option with result-based `validator` contract (`StoreValidator<T>`) and run validation on `read` in addition to write paths. Add `ValidationErrorDetails` with structured `issues` to store errors.

## 0.0.5

### Patch Changes

- a1f233e: Enable minification for all package builds, reducing bundle sizes by ~27%. Also shorten error messages in `@crustjs/core` for smaller output.
- Updated dependencies [a1f233e]
- Updated dependencies [e3624b2]
  - @crustjs/core@0.0.9

## 0.0.4

### Patch Changes

- Updated dependencies [384e2a9]
  - @crustjs/core@0.0.8

## 0.0.3

### Patch Changes

- Updated dependencies [1364768]
  - @crustjs/core@0.0.7

## 0.0.2

### Patch Changes

- 965a77c: Refactor validation API from wrapper-based `defineZodCommand`/`defineEffectCommand` to composable middleware design. Define args/flags with `arg()`/`flag()` helpers and use `withZod()`/`withEffect()` as `run` middleware for `defineCommand`. All old APIs are removed.

## 0.0.1

### Patch Changes

- 7000d56: add Effect Schema support and args/flags descrption field refactoring
- 8c23587: Add `@crustjs/validate` package with Zod 4 and Effect schema-first validation for CLI commands.

  `defineZodCommand` uses Zod schemas as the single source of truth — parser definitions, help text, runtime validation, and handler types are all derived from the schemas. Includes `arg()` and `flag()` DSL helpers, compile-time variadic/alias validation, and structured `CrustError("VALIDATION")` errors.

  Core changes: export `ValidateFlagAliases` and `ValidateVariadicArgs` utilities, add `ValidationErrorDetails` type to `VALIDATION` error code, and generalize compile-time validation types to work with any record/tuple shape.

- Updated dependencies [8c23587]
  - @crustjs/core@0.0.6
