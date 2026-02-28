# @crustjs/store

## 0.0.3

### Patch Changes

- 7f710b9: Redesign store API from field-definition schema to object-default schema. Add `dataDir`, `stateDir`, `cacheDir` XDG path helpers alongside `configDir`. Add `patch()` method for deep partial updates, `validate` option for pre-write validation, and `pruneUnknown` option for controlling unknown key behavior. Remove `FieldDef`, `FieldsDef`, `InferStoreConfig`, and `ValueType` types.
- 46a4107: Redesign validate interfaces around Standard Schema v1. Rename `withZod`/`withEffect` to `commandValidator`. Add `@crustjs/validate/standard` entrypoint with provider-agnostic prompt and store validation adapters (`promptValidator`, `parsePromptValue`, `storeValidator`). Re-export prompt/store adapters from `/zod` and `/effect` entrypoints. Replace store `validate` option with result-based `validator` contract (`StoreValidator<T>`) and run validation on `read` in addition to write paths. Add `ValidationErrorDetails` with structured `issues` to store errors.

## 0.0.2

### Patch Changes

- a1f233e: Enable minification for all package builds, reducing bundle sizes by ~27%. Also shorten error messages in `@crustjs/core` for smaller output.

## 0.0.1

### Patch Changes

- eb7e198: Replace defaults/validate API with declarative fields-based API for type-safe config persistence. Replace appName/filePath with dirPath + exported configDir() helper. Add support for multiple named JSON files via name option. Remove VALIDATION error code and validate function.
