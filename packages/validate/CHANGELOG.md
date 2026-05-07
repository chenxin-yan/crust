# @crustjs/validate

## 0.1.0

### Minor Changes

- e128dbc: # `@crustjs/validate` 0.2.0 — locked 8-function root surface

  Aligns the public API around a single mental model — schema in, typed value out — and removes the deprecated subpath barrels introduced in TP-007. **Breaking changes for 0.1.x consumers.**

  The package now exports exactly eight functions from a single root entry: `arg`, `flag`, `commandValidator`, `field`, `parseValue`, `validateStandard`, `validateStandardSync`, `isStandardSchema`.

  ## Breaking

  - **Subpath removal.** `@crustjs/validate/zod`, `@crustjs/validate/effect`, and `@crustjs/validate/standard` are gone. Replace all three with `@crustjs/validate`. Effect users wrap raw schemas once with `Schema.standardSchemaV1(...)` before passing them — the auto-wrap shim in the old `/effect` barrel was removed.
  - **`effect` peer dependency removed.** `@crustjs/validate` now imports nothing from `effect` at runtime. Users install `effect` themselves at their preferred version (≥ 3.14.2 to keep AST introspection working).
  - **Helper renames and removals.** `parsePromptValue` → `parseValue`. `parsePromptValueSync`, `promptValidator`, and `fieldSync` are removed (use `validateStandardSync` directly, pass schemas to `input({ validate: schema })` per TP-013, or rely on the new async `field()` validate respectively).
  - **`field()` shape change.** The validator-only `field(schema): (v) => Promise<void>` is replaced by a full factory `field(schema, opts?)` that returns a `FieldDef` value satisfying `@crustjs/store`'s discriminated union. Auto-derives `type`, `default`, `array`, `description` from the schema; the optional `opts` overrides any key silently and narrows the inferred config type when `default` is passed explicitly.
  - **`errorStrategy` is gone everywhere.** Prompts render the first issue inline (TP-013); `parseValue` always throws with all issues in `error.details.issues`.

  ## Migration

  ```ts
  // 0.1.x
  import { arg, flag, commandValidator } from "@crustjs/validate/zod";
  import {
    promptValidator,
    parsePromptValue,
    field,
  } from "@crustjs/validate/standard";

  // 0.2.0
  import {
    arg,
    flag,
    commandValidator,
    field,
    parseValue,
  } from "@crustjs/validate";
  // promptValidator → pass the schema directly to input({ validate: schema }).
  ```

  ```ts
  // 0.1.x
  fields: {
    theme: { type: "string", default: "light", validate: field(z.enum(["light", "dark"])) },
  }

  // 0.2.0
  fields: {
    theme: field(z.enum(["light", "dark"]).default("light")),
  }
  ```

  Schema-derived defaults populate at runtime but do NOT narrow the TypeScript type — pass `field(schema, { default: x })` explicitly when you need tight typing.

- 36f2236: # Single Standard Schema entry point + vendor-dispatch introspection

  `@crustjs/validate` now exposes one root API. Pass any
  [Standard Schema v1](https://standardschema.dev/) object — Zod, Effect,
  Valibot, ArkType, Sury, anything else — and the package introspects
  what it can (Zod and Effect natively, via vendor dispatch) and validates
  arguments, flags, prompts, and store fields against your schema.

  ## What's new

  - **Single entry point**: `arg`, `flag`, `commandValidator`,
    `promptValidator`, `field`, and friends are all importable from
    `@crustjs/validate` directly. No more guessing which subpath to use.
  - **Vendor-dispatch introspection registry**: the new internal
    `inferOptions(schema)` reads `schema["~standard"].vendor` and routes
    to per-library adapters, preserving the auto-`type` /
    auto-`required` / auto-`description` behaviour for Zod and Effect
    through one code path.
  - **Library-agnostic defaults**: any Standard Schema vendor works for
    `commandValidator()`/`arg()`/`flag()` — supply explicit `type:` (and
    `required:` / `description:`) for vendors the registry can't
    introspect.

  ## What changed (deprecation, not breaking)

  The `/zod`, `/effect`, and `/standard` subpath exports are now
  `@deprecated` aliases that re-export from the root. Existing imports
  keep working through the entire 0.x cycle. They are removed in 1.0.0.

  Migrate your imports at your leisure:

  ```ts
  // Before
  import { arg, flag, commandValidator } from "@crustjs/validate/zod";
  // After
  import { arg, flag, commandValidator } from "@crustjs/validate";
  ```

  ```ts
  // Before — raw Effect schemas accepted directly
  import { arg, flag, commandValidator } from "@crustjs/validate/effect";
  import * as Schema from "effect/Schema";

  arg("port", Schema.Number);

  // After — wrap once, import from the root
  import { arg, flag, commandValidator } from "@crustjs/validate";
  import * as Schema from "effect/Schema";

  arg("port", Schema.standardSchemaV1(Schema.Number));
  ```

  The `/effect` subpath retains an internal auto-wrap shim until 1.0.0,
  so existing Effect-based code keeps working unchanged on the deprecated
  path. The new root API requires you to wrap with
  `Schema.standardSchemaV1(...)` yourself (or use the 5-line
  `earg`/`eflag` recipe from the README).

  Legacy type aliases `ZodArgDef`, `ZodFlagDef`, `EffectArgDef`, and
  `EffectFlagDef` continue to be exported from `/zod` and `/effect` as
  `@deprecated` re-aliases of the unified `ArgDef` / `FlagDef`. Code that
  imports those names as types keeps compiling on the deprecated
  subpaths until 1.0.0. Anyone reflecting on the legacy `ZOD_SCHEMA` /
  `EFFECT_SCHEMA` runtime symbols must migrate to the new
  `VALIDATED_SCHEMA` brand.

  ## Effect peer-dep floor: `^3.14.2`

  The introspection registry walks `.ast` off
  `Schema.standardSchemaV1(...)` wrappers. PR #4648 (released in Effect
  3.14.0) added `standardSchemaV1` itself, but the wrapper kept returning
  a plain object; only Effect 3.14.2 made it extend
  `Schema.make(schema.ast)`, which exposes `.ast`. Effect 3.14.0 and
  3.14.1 silently fall through to `{}` introspection, so the peer-dep
  floor is `^3.14.2`. The deprecated `@crustjs/validate/effect` subpath
  calls `standardSchemaV1` internally and is subject to the same floor.

  ## Behaviour intentionally removed

  The `arg()` / `flag()` introspection-conflict checks no longer fire.
  Specifically, none of the following throw any more — explicit options
  always win silently:

  - `explicit type "X" conflicts with schema-inferred type "Y"`
  - `explicit required: true conflicts with schema that accepts undefined`
  - `explicit required: false conflicts with schema that does not accept undefined`

  This simplifies the model: introspection fills in fields you didn't
  specify; everything you did specify wins.

  ## Why

  A single, library-agnostic public surface lowers friction for non-Zod
  and non-Effect Standard Schema users (Valibot, ArkType, Sury, …) and
  removes a layer of indirection from the import graph. Vendor-specific
  introspection now lives in one internal registry instead of being
  duplicated across separate barrels.

### Patch Changes

- Updated dependencies [f1baa45]
- Updated dependencies [9db2613]
  - @crustjs/core@0.0.17

## 0.0.15

### Patch Changes

- 930e3c7: Align Zod and Effect flag definitions with core `FlagDefBase` by adding `inherit` support to the exported types and `flag()` helpers.

  This makes `flag(..., { inherit: true })` behave consistently across validate and core, preserving inherited flag metadata for subcommands.

## 0.0.14

### Patch Changes

- Updated dependencies [def425e]
  - @crustjs/core@0.0.16

## 0.0.13

### Patch Changes

- Updated dependencies [5e0afa4]
  - @crustjs/core@0.0.15

## 0.0.12

### Patch Changes

- Updated dependencies [f78b327]
  - @crustjs/core@0.0.14

## 0.0.11

### Patch Changes

- Updated dependencies [6dea64c]
  - @crustjs/core@0.0.13

## 0.0.10

### Patch Changes

- Updated dependencies [b8ebfa4]
  - @crustjs/core@0.0.12

## 0.0.9

### Patch Changes

- Updated dependencies [9f81bcc]
- Updated dependencies [72ea166]
  - @crustjs/core@0.0.11

## 0.0.8

### Patch Changes

- 96ca6b2: Adopt the new builder-style command API across core and official packages, including inherited flags, lifecycle hooks, plugin usage, and command metadata improvements. Update related tooling, templates, and documentation to align with the new command authoring flow.
- Updated dependencies [96ca6b2]
  - @crustjs/core@0.0.10

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
