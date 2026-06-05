# @crustjs/store

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

- d08439a: Internal refactor: `ValueType`, `ResolvePrimitive`, and string coercion now use shared `@crustjs/utils` primitives with no consumer-visible behavior change.
- Updated dependencies [0dc69b1]
- Updated dependencies [d08439a]
  - @crustjs/utils@0.0.2

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

- ac049c8: Schema-driven transforms in `field()` now persist on `write`, `update`,
  and `patch`. On `read`, the schema still validates the persisted value
  but its transform output is discarded — the returned value matches what
  is on disk.
  - `field(z.string().transform(s => s.trim()))` now writes the **trimmed**
    value to disk on `store.write({ name: "  hi  " })`. Same for `update`
    and `patch`.
  - A write-time **read-stability guard** rejects transforms whose output
    the schema would reject on a subsequent read. For example,
    `field(z.string().transform(s => s.length))` (string in, number out)
    fails with `CrustStoreError("VALIDATION")` tagged
    `read-unstable transform`. Nothing is written.
  - Hand-rolled `validate: (v) => { ... }` callbacks that return `void`
    remain validation-only and are unaffected.

  ### Behavior change (pre-1.0 minor break)

  If you use `field(schemaWithTransform)` today, existing on-disk values
  **survive unchanged** on the next `read()` — no automatic migration.
  The first subsequent `write` / `update` / `patch` canonicalizes the
  value through the transform.

  Concrete: a store with `field(z.string().transform(s => s.trim()))` that
  has `{ name: "  hi  " }` on disk will:
  1. `await store.read()` → `{ name: "  hi  " }` (untouched)
  2. `await store.write({ name: "  hi  " })` → file becomes `{ name: "hi" }`

  ### Type contract widening

  `FieldDef.validate` widens from `(value: V) => void | Promise<void>` to
  `(value: V) => void | Promise<void> | { value: unknown } | Promise<{ value: unknown }>`.
  The new shapes are additive — `void`-returning validators are unchanged.

### Patch Changes

- 3421dbf: Fix two `@crustjs/store` bugs around the validator contract.

  **1. `field({ default: undefined })` is now honored.**

  The implementation previously checked both `"default" in opts` **and**
  `opts.default !== undefined`, silently dropping an explicitly-passed
  `undefined` default and falling back to schema extraction. This
  contradicted both the inline comment ("we never use `=== undefined` as a
  sentinel") and the `D extends InferOutput<S>` overload contract, which
  allows `D = undefined` for optional schemas. The `!== undefined` clause
  has been removed; `"default" in opts` is now the sole sentinel for
  "caller explicitly set a default".

  ```ts
  // Now correctly honored:
  field(z.string().optional().default("fallback"), { default: undefined });
  // → default: undefined  (not "fallback")
  ```

  **2. `FieldDef.validate` fail-fast guard no longer misclassifies as `VALIDATION`.**

  The migration guard that throws `TypeError` when a validator returns a
  value (legacy `{ ok, issues }` shape) previously ran _inside_ the same
  `try/catch` block that captures legitimate validation rejections —
  silently re-wrapping the programming error as
  `CrustStoreError("VALIDATION")`. Consumers branching on `err.code ===
"VALIDATION"` could not distinguish a caller bug from a bad config value.

  The guard now runs **outside** the `try` block, so:
  - Buggy validators returning a value surface as `TypeError` (programming
    error, propagates up).
  - User code that legitimately throws `TypeError` from inside their
    validator is still collected as a regular validation issue, unchanged.

- 3421dbf: Unified validator contract: throw on fail, void on success.

  Every hand-rolled function validator across the workspace now follows the
  **same rule**: return `void` (or `Promise<void>`) when the value is valid;
  **throw an `Error`** to reject. The thrown error's `message` is what the
  caller surfaces (rendered inline by prompts, captured as the issue text by
  store).

  This unifies what was previously two contracts:

  | Surface                                                | Before                                                 | After                                             |
  | ------------------------------------------------------ | ------------------------------------------------------ | ------------------------------------------------- |
  | `@crustjs/prompts` `input()` / `password()` `validate` | `(v) => true \| string \| Promise<…>`                  | `(v) => void \| Promise<void>`, throws on failure |
  | `@crustjs/store` `FieldDef.validate`                   | `(v) => void \| Promise<void>` (already throw-on-fail) | unchanged                                         |

  ### `@crustjs/prompts` (major) — breaking change

  `ValidateFn<T>` is now `(value: T) => void | Promise<void>`. Throw to
  reject. The `ValidateResult` type alias is removed (there is no return
  value).

  ```ts
  // Before
  input({
  	message: "Email?",
  	validate: (v) => v.includes("@") || "Must contain @",
  });

  // After
  input({
  	message: "Email?",
  	validate: (v) => {
  		if (!v.includes("@")) throw new Error("Must contain @");
  	},
  });
  ```

  Inline error rendering is unchanged — prompts catches the thrown `Error`
  and renders `err.message` below the prompt, identical to how schema issues
  are rendered.

  A runtime **fail-fast guard** is added: if a `validate` function returns
  any value other than `undefined`, prompts throws a `TypeError` naming the
  unexpected return type. This catches the common migration mistake of
  leaving a `return true || "..."` expression in place.

  Schema-driven validation (`validate: zSchema`) is unchanged.

  ### `@crustjs/store` (patch)

  Same fail-fast guard added to `FieldDef.validate`: returning any value
  other than `undefined` now throws a `TypeError`. The throw-on-fail
  contract has always been the documented one — the guard prevents the
  silent-success bug that came from older docs incorrectly suggesting a
  `{ ok, value } | { ok, issues }` return shape.

  Existing throw-based custom validators are unaffected.

- Updated dependencies [3421dbf]
  - @crustjs/schema-utils@0.0.1

## 0.0.4

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
