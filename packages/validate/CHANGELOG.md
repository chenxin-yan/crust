# @crustjs/validate

## 0.1.1

### Patch Changes

- 0dc69b1: Introduce `@crustjs/utils`, fold in `@crustjs/schema-utils`, dedupe `resolveSourceDir`, and switch validated helpers to explicit Standard Schema-backed validation.

  **`@crustjs/utils` (new, `0.0.1`)** — Pre-stable; public surface may change without notice until `0.1.0`. Pin to an exact version if depending externally.
  - `resolveSourceDir(input: string | URL): string` for three-mode source-directory resolution (`file:` URL via `fileURLToPath`, absolute path via `path.resolve`, or relative path resolved from the nearest `package.json` walking up from `process.argv[1]`).
  - `@crustjs/utils/schema` subpath exposes Standard Schema boundary assertions, issue normalization, and type aliases (`assertStandardSchema`, `isStandardSchema`, `formatPath`, `normalizeStandardIssues`, `normalizeStandardPath`, plus `StandardSchema` / `InferInput` / `InferOutput` / `ValidationIssue`). Internal-only — **not part of the public Crust API** and may change without a deprecation cycle. Use `@crustjs/validate` instead.
  - `@crustjs/utils/schema` is core-free shared infrastructure; package-specific APIs wrap errors at their own boundaries.

  **`@crustjs/schema-utils` removed.** The standalone workspace package is gone; its surface lives at `@crustjs/utils/schema`. The published `@crustjs/schema-utils@0.0.1` artifact on npm will be deprecated separately.

  **`@crustjs/core`, `@crustjs/validate`, `@crustjs/store` — raw schema-backed validation.** Vendor-specific schema introspection is removed; validated helpers now use Standard Schema validation over parsed values. `arg()`, `flag()`, and `field()` no longer infer type, requiredness, descriptions, multiplicity, or defaults from Zod/Effect internals. Missing values are passed to validation as `undefined`, so schema `.optional()` and `.default()` behavior applies naturally at runtime.
  - Validated positional args can omit parser `type`; they validate the raw positional string (or string array for variadic args) through the schema.
  - Validated CLI flags must declare parser `type` because it defines CLI grammar/token ownership: boolean flags do not consume a value, while string/number flags consume `--flag value` / `--flag=value`. Schemas validate and transform after parsing.
  - Descriptions must now be supplied through Crust options.
  - The internal `@crustjs/utils/schema` introspection exports (`inferOptions`, `extractDefault`, and related types) were removed.
  - This is a public behavior change for metadata-driven parser/help/store consumers: add explicit Crust metadata (`type`, `multiple`, `description`, `default`, etc.) where that metadata is still needed.

  **`@crustjs/create`, `@crustjs/skills` — internal dedup onto `resolveSourceDir`.** Public signatures and behavior of `createProject()` and `installSkillBundle()` are unchanged, but the wording of three thrown `Error` messages now comes from the shared helper:
  - `"Template URL must use file: protocol, got ..."` / `"Bundle URL must use file: protocol, got ..."` → `"sourceDir URL must use file: protocol, got ..."`
  - `"Could not resolve relative template path ..."` / `"Could not resolve relative bundle path ..."` → `"Could not resolve relative sourceDir ..."` (both `process.argv[1]` unset and missing-`package.json` variants)

  Consumers that match on `Error.message` text from these three failure modes will need to update their patterns. All other thrown messages (`Template directory does not exist`, `Template path is not a directory`, path-traversal rejection, `Bundle source directory does not exist`, missing `SKILL.md`, destination-conflict, etc.) are unchanged.

  The `@internal`-tagged `resolveBundleSourceDir` export from `@crustjs/skills/bundle` was removed. It carried `@internal` JSDoc and was undocumented (exported only for direct unit-test access); its behavior is preserved by `resolveSourceDir` from `@crustjs/utils`.

- Updated dependencies [0dc69b1]
- Updated dependencies [d08439a]
- Updated dependencies [d08439a]
- Updated dependencies [c4d2b22]
- Updated dependencies [c4d2b22]
  - @crustjs/utils@0.0.2
  - @crustjs/core@0.0.18

## 0.1.0

### Minor Changes

- 3421dbf: `field()` moved from `@crustjs/validate` to `@crustjs/store`.

  The Standard-Schema-first store-field factory previously lived in
  `@crustjs/validate` for historical reasons — the introspection layer used
  to live inside validate before `@crustjs/schema-utils` was extracted (see
  TP-017). Now that schema-utils exists as a shared internal package, the
  factory that produces a store `FieldDef` belongs in the package that owns
  `FieldDef`.

  ### Migration

  ```ts
  // Before
  import { field } from "@crustjs/validate";

  // After
  import { field } from "@crustjs/store";
  ```

  No behaviour change. Same Standard Schema input, same `FieldDef` output,
  same per-field async `validate` adapter.

  ### `@crustjs/validate` (major) — public surface reduced

  The locked TP-014 root surface shrinks from **8 functions to 7**:

  | Removed               | Replacement                                          |
  | --------------------- | ---------------------------------------------------- |
  | `field`               | `import { field } from "@crustjs/store"`             |
  | `FieldOptions` (type) | `import type { FieldOptions } from "@crustjs/store"` |

  The remaining 7 functions (`arg`, `flag`, `commandValidator`, `parseValue`,
  `validateStandard`, `validateStandardSync`, `isStandardSchema`) are
  unchanged.

  ### `@crustjs/store` (minor) — new schema-driven API

  `@crustjs/store` now exports `field()` and `FieldOptions` from its root.
  Schema-derived field defaults, descriptions, and the per-field validator
  are derived in one call:

  ```ts
  import { configDir, createStore, field } from "@crustjs/store";
  import { z } from "zod";

  const store = createStore({
  	dirPath: configDir("my-cli"),
  	fields: {
  		theme: field(z.enum(["light", "dark"]).default("light")),
  		port: field(z.number().int().min(1).default(3000)),
  	},
  });
  ```

  `field()` throws `CrustStoreError("DEFINITION")` (with `details.vendor`)
  on non-Standard-Schema input or when the CLI type cannot be inferred from
  an unknown vendor — previously this was `CrustError("DEFINITION")`. Catch
  the new error class when porting:

  ```ts
  // Before
  import { CrustError } from "@crustjs/core";
  try { field(opaque); } catch (err) { if (err instanceof CrustError) … }

  // After
  import { CrustStoreError } from "@crustjs/store";
  try { field(opaque); } catch (err) { if (err instanceof CrustStoreError) … }
  ```

  `@crustjs/store` gains a runtime dependency on `@crustjs/schema-utils`
  (internal workspace package, ~6.7 KB gzipped). Store consumers who never
  call `field()` still ship this dependency.

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
  import { promptValidator, parsePromptValue, field } from "@crustjs/validate/standard";

  // 0.2.0
  import { arg, flag, commandValidator, field, parseValue } from "@crustjs/validate";
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

- 3421dbf: Internal refactor — no observable API change.

  `@crustjs/validate`'s Standard Schema introspection layer has been moved into
  a new internal workspace package, `@crustjs/schema-utils`. It is published to
  npm only so that `@crustjs/validate`'s `dependencies` resolve for external
  installs; it is not part of the public Crust API and may change without a
  deprecation cycle. Consumers of `@crustjs/validate` do not need to change any
  imports.

- Updated dependencies [b87e0ee]
- Updated dependencies [f1baa45]
- Updated dependencies [8779692]
- Updated dependencies [3421dbf]
- Updated dependencies [9db2613]
  - @crustjs/core@0.0.17
  - @crustjs/schema-utils@0.0.1

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
