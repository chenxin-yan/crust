# Task: TP-007 — Migrate `@crustjs/validate` to a single Standard Schema entry point with vendor dispatch

**Created:** 2026-04-29
**Size:** L

## Review Level: 2 (Plan + Code)

**Assessment:** Public API consolidation across a published package, plus a
nontrivial internal restructure (vendor-dispatch introspection registry).
The high-level design is locked, but plan-review locks the final inferred
fields, vendor adapter shape, deprecated-alias behavior, and Effect peer
version floor. Code-review verifies behavior parity for both Zod and
wrapped-Effect introspection across the merged test suite.
**Score:** 6/8 — Blast radius: 2, Pattern novelty: 1 (vendor-dispatch is new in this repo), Security: 1, Reversibility: 2

## Canonical Task Folder

```
taskplane-tasks/TP-007-validate-standard-schema-only/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (created by the orchestrator runtime)
└── .DONE       ← Created when complete
```

## Mission

Collapse `@crustjs/validate` from three subpath exports (`/zod`, `/effect`,
`/standard`) into a single root entry point. The new public API accepts only
Standard Schema v1 objects. Internally, a small vendor-dispatch registry
reads `~standard.vendor` to introspect Zod (raw schemas, which are Standard
Schemas natively in Zod 4) and Effect (schemas wrapped via
`Schema.standardSchemaV1()`, which expose `.ast` for AST walking on Effect
≥ 3.14). Auto-inference covers `type`, `required`, `default`, `description`,
and transform/coercion handling for both vendors. Other Standard Schema
libraries (Valibot, ArkType, etc.) require explicit options at registration.
Subpath exports remain in 0.1.0 as `@deprecated` aliases with copy-pasteable
migration TSDoc; the deprecated `/effect` barrel keeps its auto-wrap shim
so existing Effect-using code continues to run unchanged through the entire
0.x cycle. All deprecated aliases are removed in 1.0.0. Bump to **0.1.0**
(minor in Changesets terms — pre-1.0 breaking changes are minor under the
project's pre-1.0 stance).

## Dependencies

- **None**

## Context to Read First

> Only list docs the worker actually needs. Less is better.

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `packages/validate/README.md` — current public-API documentation, will be rewritten
- `packages/validate/src/index.ts` — current root exports (types only)
- `packages/validate/src/standard/index.ts` — soon-to-be-promoted core
- `packages/validate/src/standard/validate.ts` — Standard Schema execution helpers (preserve as-is, relocate to root)
- `packages/validate/src/standard/prompt.ts` + `store.ts` — adapters (preserve, relocate)
- `packages/validate/src/middleware.ts` — `buildValidatedRunner` (preserve; simplify the schema-marker parameter to a single symbol)
- `packages/validate/src/validation.ts` — `formatPath` etc. (preserve)
- `packages/validate/src/resolve-options.ts` — most helpers die when introspection is centralized; keep `validateArgArrayShape` if still referenced
- `packages/validate/src/types.ts` — shared types
- `packages/validate/src/zod/schema.ts` — current Zod introspection (~470 LoC); relocate logic to `src/introspect/zod.ts` adapted for Standard-Schema-wrapped input
- `packages/validate/src/effect/schema.ts` — current Effect AST walker (~470 LoC); relocate logic to `src/introspect/effect.ts` reading `.ast` off the wrapper instead of off raw schemas
- `packages/validate/src/zod/command.ts` + `effect/command.ts` — current per-library `commandValidator`; collapse to one
- `packages/validate/src/zod/types.ts` + `effect/types.ts` — schema-marker symbol + strict-mode brand; collapse to one symbol
- `packages/validate/src/zod/command.test.ts` — 65 tests; ~17 die (introspection-conflict assertions)
- `packages/validate/src/effect/command.test.ts` — 64 tests; ~18 die (same plus one annotation-fallback test)
- `packages/validate/src/standard/prompt.test.ts` + `store.test.ts` + `validate.test.ts` — preserve, relocate
- `packages/validate/src/scaffold.test.ts` + `validation.test.ts` — preserve
- `packages/validate/tests/cross-target-integration.test.ts` — direct imports from `src/effect/index.ts` and `src/zod/index.ts`; needs full rewrite to use the unified root + already models the wrap-yourself pattern at lines 178-180
- `packages/validate/package.json` — exports, peerDeps, deps; current `effect: ^3.19.0` covers the `^3.14` floor required for AST-through-wrapper access
- `apps/docs/content/docs/modules/validate.mdx` — to be rewritten
- `apps/docs/content/docs/modules/store.mdx` (line ~306) and `prompts.mdx` — examples reference `/zod` subpath
- `packages/store/README.md` lines 320 + 350 — examples reference `/zod` and `/effect` subpaths

**Research artifacts (created during scoping; consult only if a design assumption is in question):**
- The Standard Schema spec defines `~standard.vendor` as a REQUIRED `string`. Source: https://github.com/standard-schema/standard-schema/blob/main/packages/spec/src/index.ts
- Zod 4 schemas attach `~standard` lazily at the base `$ZodType` constructor; every schema (primitive, wrapper, enum, array, transform, pipe) inherits it natively with `vendor: "zod"`. Source: https://github.com/colinhacks/zod/blob/main/packages/zod/src/v4/core/schemas.ts
- Effect ≥ 3.14: `Schema.standardSchemaV1(s)` returns a class that `extends make(s.ast)`, so the wrapper exposes `.ast` (same instance as the raw schema's AST), and `Schema.isSchema(wrapper) === true`. Source: https://github.com/Effect-TS/effect/blob/main/packages/effect/src/Schema.ts (lines 196-225). PR that landed this: https://github.com/Effect-TS/effect/pull/4648 (closed issue #4494). Effect 3.13.x wrappers were opaque — the new design assumes 3.14+.
- `~standard.validate` may return a Promise per spec; Zod 4 actively does so when sync parsing throws `$ZodAsyncError`.

## Environment

- **Workspace:** `packages/validate/` (primary), `apps/docs/`, `packages/store/README.md`
- **Services required:** None

## File Scope

**Add (new top-level files):**
- `packages/validate/src/index.ts` (rewrite — single root export; the previous types-only barrel is replaced)
- `packages/validate/src/schema.ts` (new — `arg()` and `flag()` accepting any Standard Schema with optional CLI-only metadata)
- `packages/validate/src/command.ts` (new — single `commandValidator()` accepting any Standard Schema)
- `packages/validate/src/prompt.ts` (moved from `standard/prompt.ts`)
- `packages/validate/src/store.ts` (moved from `standard/store.ts`)
- `packages/validate/src/validate.ts` (moved from `standard/validate.ts`)
- `packages/validate/src/introspect/registry.ts` (new — `inferOptions(schema): InferredOptions` dispatching on `~standard.vendor`)
- `packages/validate/src/introspect/zod.ts` (new — relocated and adapted introspection for `vendor: "zod"`; reads off the schema directly since Zod 4 schemas are Standard Schemas natively)
- `packages/validate/src/introspect/effect.ts` (new — relocated AST walker for `vendor: "effect"`; reads off `wrapper.ast` instead of off a raw `Schema<...>`)
- `packages/validate/src/types.ts` (consolidate — fold `standard/types.ts` into existing `types.ts`; replace `[ZOD_SCHEMA]` and `[EFFECT_SCHEMA]` with one `[VALIDATED_SCHEMA]` symbol)
- `packages/validate/src/middleware.ts` (preserve — simplify `buildValidatedRunner` to take a single `validateValue` callback now that there's one schema marker)
- `packages/validate/src/validation.ts` (preserve)
- `packages/validate/src/resolve-options.ts` (preserve only `validateArgArrayShape` if still imported from `schema.ts`; delete the rest)

**Add (deprecated alias barrels — kept until 1.0.0):**
- `packages/validate/src/zod/index.ts` (rewrite — pure re-export from `../index.ts` with `@deprecated` TSDoc on every export)
- `packages/validate/src/effect/index.ts` (rewrite — re-export PLUS retain the auto-wrap shim. The deprecated `commandValidator`, `arg`, `flag` from this barrel must continue to accept raw Effect schemas without explicit `Schema.standardSchemaV1()` from the user, by detecting raw schemas via `Schema.isSchema()` and wrapping internally. ~50 LoC of shim code.)
- `packages/validate/src/standard/index.ts` (rewrite — pure re-export from `../index.ts` with `@deprecated` TSDoc on every export)

**Delete (no longer needed):**
- `packages/validate/src/zod/schema.ts`
- `packages/validate/src/zod/command.ts`
- `packages/validate/src/zod/types.ts`
- `packages/validate/src/zod/command.test.ts` (assertions migrate to merged suite)
- `packages/validate/src/effect/schema.ts`
- `packages/validate/src/effect/command.ts`
- `packages/validate/src/effect/types.ts`
- `packages/validate/src/effect/command.test.ts` (assertions migrate to merged suite)
- `packages/validate/src/standard/index.ts` (after the new barrel above is created in its place, since the old file's content is just a re-export; new barrel at the same path is the deprecated alias)
- `packages/validate/src/standard/types.ts`
- `packages/validate/src/standard/prompt.ts` (moved up to `src/prompt.ts`)
- `packages/validate/src/standard/store.ts` (moved up to `src/store.ts`)
- `packages/validate/src/standard/validate.ts` (moved up to `src/validate.ts`)
- `packages/validate/src/standard/prompt.test.ts` (moved up to `src/prompt.test.ts`)
- `packages/validate/src/standard/store.test.ts` (moved up to `src/store.test.ts`)
- `packages/validate/src/standard/validate.test.ts` (moved up to `src/validate.test.ts`)

**Add tests:**
- `packages/validate/src/command.test.ts` (new — merged suite covering both Zod and Effect through one entry point; introspection-conflict tests deleted)
- `packages/validate/src/introspect/registry.test.ts` (new — vendor-dispatch correctness, including unknown-vendor fallback)

**Modify:**
- `packages/validate/package.json` — single `.` export plus the three deprecated subpath exports (`./zod`, `./effect`, `./standard`). Bump `version` to `0.1.0`. Reconsider peerDeps: keep `@crustjs/core` and `typescript`. Move `zod` from peerDeps to devDeps only (test-only). Keep `effect` in peerDeps but raise the floor to `^3.14.0` (current `^3.19.0` already satisfies); document why in TSDoc on the unified `commandValidator`.
- `packages/validate/README.md` — full rewrite reflecting single entry point + deprecation timeline + Effect wrap requirement on the new root + helper recipe for Effect users
- `packages/validate/tests/cross-target-integration.test.ts` — rewrite imports to use root entry point; preserve test intent
- `apps/docs/content/docs/modules/validate.mdx` — full rewrite mirroring the new README structure
- `apps/docs/content/docs/modules/index.mdx` — update if it tabulates validate's entry points
- `apps/docs/content/docs/modules/prompts.mdx` — update example imports
- `apps/docs/content/docs/modules/store.mdx` (line ~306) — update example imports
- `packages/store/README.md` (lines 320 and 350) — update example imports
- `.changeset/*.md` (new — minor for `@crustjs/validate`)

## Steps

> **Hydration:** STATUS.md tracks outcomes, not individual code changes. Workers
> expand steps when runtime discoveries warrant it. See task-worker agent for rules.

### Step 0: Preflight

- [ ] `bun install` clean
- [ ] All existing `@crustjs/validate` tests pass before any changes: `cd packages/validate && bun test`
- [ ] **3-line spec sanity probe** (REPL or scratch test). Confirm and record exact values in STATUS.md Notes:
  ```ts
  import { z } from "zod";
  import * as Schema from "effect/Schema";

  console.log(z.number()["~standard"].vendor);
  // expect: "zod"

  const wrapped = Schema.standardSchemaV1(Schema.Number);
  console.log(wrapped["~standard"].vendor);
  // expect: "effect"

  console.log((wrapped as any).ast?._tag);
  // expect: "NumberKeyword"

  console.log(Schema.isSchema(wrapped));
  // expect: true
  ```
  If any of the four assertions fails on the repo's pinned versions, STOP and escalate. Design depends on these.
- [ ] Record the resolved `effect` and `zod` versions from `bun install` lockfile in Notes.
- [ ] Confirm via grep that no internal package source code consumes `@crustjs/validate` (only docs and READMEs reference it). Record findings in Notes.
- [ ] Confirm via grep that `tests/cross-target-integration.test.ts` is the only in-repo test importing the per-library subpaths directly. Record in Notes.

### Step 1: Plan checkpoint — lock final API + introspection contract

> **Review override: plan + code** — both reviews required.

Produce a short design note in STATUS.md confirming the public surface,
the internal vendor-dispatch contract, and the deprecation policy. The
reviewer must verify all of the following before allowing Step 2:

- [ ] **Public exports (final list)** — emitted from `src/index.ts` only:
  - **Functions**: `arg`, `flag`, `commandValidator`, `promptValidator`, `parsePromptValue`, `parsePromptValueSync`, `field`, `fieldSync`
  - **Types**: `StandardSchema`, `InferInput`, `InferOutput`, `ValidationResult`, `ValidatedContext`, `ValidationIssue`, `ArgOptions`, `FlagOptions`, `PromptErrorStrategy`, `PromptValidatorOptions`, `CommandValidatorHandler`, `InferValidatedArgs`, `InferValidatedFlags`
  - **Internal helpers** (`validateStandard`, `validateStandardSync`, `isStandardSchema`): preserve whatever was previously exported from `standard/index.ts` — re-verify during plan and record decision
- [ ] **`arg()` signature**:
  ```ts
  function arg<S extends StandardSchema>(
    name: string,
    schema: S,
    options?: ArgOptions,
  ): ArgDef<S>;
  ```
- [ ] **`flag()` signature**:
  ```ts
  function flag<S extends StandardSchema>(
    schema: S,
    options?: FlagOptions,
  ): FlagDef<S>;
  ```
- [ ] **`ArgOptions` shape** — every field optional; only needed when introspection cannot supply it OR when the user wants to override CLI-only metadata:
  ```ts
  interface ArgOptions {
    /** Override or supply when vendor-dispatch can't infer (unknown vendor / pre-Effect-3.14 wrapper). Required for unknown vendors at runtime. */
    type?: "string" | "number" | "boolean";
    description?: string;
    required?: boolean;
    default?: unknown;
    variadic?: boolean;
  }
  ```
  Worker confirms the precise field set against today's `ArgOptions` in `zod/types.ts` and `effect/types.ts` and records any divergence.
- [ ] **`FlagOptions` shape**:
  ```ts
  interface FlagOptions {
    type?: "string" | "number" | "boolean";
    description?: string;
    required?: boolean;
    default?: unknown;
    short?: string;
    multiple?: boolean;
    inherit?: boolean;
  }
  ```
- [ ] **Introspection registry contract**: `src/introspect/registry.ts` exports a single internal `inferOptions(schema: StandardSchema, kind: "arg" | "flag"): InferredOptions` function. Implementation switches on `schema["~standard"].vendor`:
  - `"zod"` → call `inferFromZod(schema)`. Reads `_zod.def.*` directly off the schema (Zod 4 schemas ARE Standard Schemas natively).
  - `"effect"` → call `inferFromEffect(schema)`. Reads `(schema as any).ast` off the wrapper (works on Effect ≥ 3.14; documented in README).
  - any other vendor → return `{}` (empty inference). User-supplied options must cover everything required; missing required fields throw `CrustError("DEFINITION")` at registration.
- [ ] **Inferred fields per vendor (Zod and Effect)**: `type`, `required`, `default`, `description`, transform/pipe input-type unwrapping. Match the surface of today's introspection. Worker records any field today's introspection produces that the new registry chooses NOT to reproduce — these become explicit-only.
- [ ] **Effect peer dep floor**: bump `effect` peerDep to `^3.14.0`. Document in changeset that introspection of pre-wrapped Effect schemas requires Effect ≥ 3.14 because of [PR #4648](https://github.com/Effect-TS/effect/pull/4648). Older Effect users either upgrade or use the deprecated `/effect` subpath which auto-wraps internally.
- [ ] **Effect users on the NEW root** must wrap with `Schema.standardSchemaV1()` themselves. Identical to the current prompt/store contract. The README provides a 5-line `earg`/`eflag` user-space helper recipe. The package itself does NOT export this helper.
- [ ] **Effect users on the DEPRECATED `/effect` path** continue to pass raw Effect schemas. The deprecated barrel auto-detects via `Schema.isSchema()` and wraps internally before delegating to root introspection. ~50 LoC of shim retained until 1.0.0.
- [ ] **Standard Schema validation behavior preserved**:
  - All validation outcomes (success/failure/issue paths) unchanged
  - `CrustError("VALIDATION")` semantics unchanged
  - Async schemas (Promise-returning `~standard.validate`) handled with `await`
  - `commandValidator` strict-mode (mixing plain core defs with validated defs) — preserve compile-time `never` behavior using a single `[VALIDATED_SCHEMA]` brand symbol
  - Plugin-injected flags (e.g. `--help`) continue to be skipped at runtime
- [ ] **Behavior intentionally removed** (document for changeset + migration notes):
  - The `ParserMeta` conflict-detection error path ("type explicit conflicts with inferred") goes away — explicit value always wins, no inference clash possible. Worker records this clearly so the changeset is honest.
  - Pre-1.0 Standard Schema users (Valibot, ArkType, etc.) who had no introspection before continue to declare options explicitly.
- [ ] **Deprecated alias policy** locked:
  - `/zod`: pure re-export barrel. ~5 LoC. `@deprecated` TSDoc on every re-export with a copy-pasteable migration block.
  - `/standard`: pure re-export barrel. ~5 LoC. `@deprecated` TSDoc.
  - `/effect`: re-export barrel + auto-wrap shim for `commandValidator`/`arg`/`flag`. ~50 LoC. `@deprecated` TSDoc on every re-export.
  - All three live until **1.0.0**. The 1.0.0 release will delete them; that work is out of scope here.
- [ ] **Out of scope**:
  - Probing-based introspection (no trial-validate calls)
  - Vendor adapters beyond Zod and Effect (Valibot/ArkType users declare options explicitly)
  - Codemod / migration tooling
  - Changes to `@crustjs/store`, `@crustjs/prompts`, or `@crustjs/core` source code
- [ ] Plan-review APPROVE recorded in `.reviews/`

**Do not start Step 2 until plan-review APPROVE.**

### Step 2: Move and consolidate the standard/ core to top-level

- [ ] Move `src/standard/validate.ts` → `src/validate.ts`
- [ ] Move `src/standard/prompt.ts` → `src/prompt.ts`
- [ ] Move `src/standard/store.ts` → `src/store.ts`
- [ ] Move `src/standard/prompt.test.ts` → `src/prompt.test.ts`
- [ ] Move `src/standard/store.test.ts` → `src/store.test.ts`
- [ ] Move `src/standard/validate.test.ts` → `src/validate.test.ts`
- [ ] Fold `src/standard/types.ts` content into `src/types.ts` (single types module)
- [ ] Update all imports within the moved files to use new relative paths
- [ ] Delete the now-empty `src/standard/` directory contents (the deprecated `src/standard/index.ts` barrel will be re-created in Step 8)
- [ ] `cd packages/validate && bun test` passes

### Step 3: Build the introspection registry

- [ ] Create `src/introspect/registry.ts` with `inferOptions(schema, kind)` dispatching on `schema["~standard"].vendor`
- [ ] Create `src/introspect/zod.ts`. Port the logic from today's `src/zod/schema.ts` (`unwrapInputSchema`, `resolvePrimitiveInputType`, `tryResolveInputShape`, `isOptionalInputSchema`, `resolveDescription`, default-extraction). Adjust to operate on a Standard Schema (Zod 4 schemas are themselves Standard Schemas — the existing logic already reads `_zod.def.*` directly, no adapter shim needed).
- [ ] Create `src/introspect/effect.ts`. Port the logic from today's `src/effect/schema.ts` (`unwrapInputAst`, `resolvePrimitiveInputType`, `resolveTupleArrayShape`, `tryResolveInputShape`, `acceptsUndefined`, `resolveDescription`, default-extraction via `getDefaultAnnotation`). Crucial change: read `(schema as { ast?: AST.AST }).ast` off the wrapper instead of off a raw `Schema<...>`. If `ast` is missing (Effect 3.13.x or hand-rolled wrapper), the function returns `{}` and the caller falls back to user-supplied options.
- [ ] Create `src/introspect/registry.test.ts`. Cover: Zod inference happy path, Effect inference happy path on a wrapped schema, unknown-vendor fallback (e.g. construct a synthetic `{ "~standard": { version: 1, vendor: "valibot", validate: ... } }`), graceful handling when `ast` is absent on a Standard Schema with `vendor: "effect"`.
- [ ] `cd packages/validate && bun run check:types` passes

### Step 4: Implement new top-level `arg()`, `flag()`, and `commandValidator()`

- [ ] Create `src/schema.ts` exporting `arg()` and `flag()`. Behavior:
  - Validate runtime that `schema` is a Standard Schema (`isStandardSchema` from `validate.ts`); throw `CrustError("DEFINITION")` if not, naming the failing arg/flag.
  - Call `inferOptions(schema, kind)` to populate defaults.
  - Merge user-supplied `options` over inferred values (user-supplied always wins).
  - For unknown vendors with no inferred `type`, throw `CrustError("DEFINITION")` at registration with a clear message naming the arg/flag, the detected `vendor`, and the fix ("supply `type:` in options OR use `@crustjs/validate/effect` for Effect on the deprecated path").
  - Brand the resulting def with the `[VALIDATED_SCHEMA]` symbol so the strict-mode `never` brand check can find it.
  - Pass through CLI-only metadata (`short`, `multiple`, `inherit`, `variadic`).
- [ ] Create `src/command.ts` exporting `commandValidator()`. Behavior:
  - Generic over `A extends ArgsDef`, `F extends FlagsDef`
  - Accepts `handler: CommandValidatorHandler<A, F>` typed via Standard Schema's `InferOutput`
  - Returns a `(context: CrustCommandContext<A, F>) => Promise<void>`
  - Internally calls `buildValidatedRunner` from `middleware.ts`, supplying a `validateStandard`-based per-schema validator
  - Strict-mode behavior preserved: handler param becomes `never` if any arg/flag is not branded with `[VALIDATED_SCHEMA]`
- [ ] Update `src/index.ts` to export the final public surface from Step 1 and nothing more.
- [ ] `cd packages/validate && bun run check:types` passes

### Step 5: Delete obsolete library-specific source

- [ ] Delete `src/zod/schema.ts`, `src/zod/command.ts`, `src/zod/types.ts`, `src/zod/command.test.ts`
- [ ] Delete `src/effect/schema.ts`, `src/effect/command.ts`, `src/effect/types.ts`, `src/effect/command.test.ts`
- [ ] Trim `src/resolve-options.ts` — keep only `validateArgArrayShape` if `src/schema.ts` imports it; otherwise delete the file
- [ ] Simplify `src/middleware.ts` `buildValidatedRunner` signature: now there's only one schema marker and one validator path
- [ ] `cd packages/validate && bun run check:types` passes

### Step 6: Consolidate command tests

- [ ] Create `src/command.test.ts`. Migrate the surviving ~94 behavior tests from the deleted command suites. For each:
  - Zod fixtures stay raw (Zod 4 schemas are Standard Schemas natively)
  - Effect fixtures wrap once at fixture setup with `Schema.standardSchemaV1(...)`
  - Both vendors exercise the same code path through `arg()`, `flag()`, `commandValidator`
- [ ] Cover both vendors for: successful validation, invalid input → `CrustError("VALIDATION")`, async refinement, `.transform()` / `.pipe()` / coerce, variadic with array schema, optional/default, plugin-injected flag silently skipped, strict-mode compile-error case (TypeScript-level test using `// @ts-expect-error`).
- [ ] Delete the introspection-conflict tests: "throws when explicit type conflicts with inferred type", "throws when explicit required: true conflicts with optional schema", and the matching "accepts explicit ... that matches" sanity tests. Document each deletion in STATUS.md Discoveries.
- [ ] `cd packages/validate && bun test` passes

### Step 7: Rewrite `tests/cross-target-integration.test.ts`

- [ ] Replace direct `src/effect/index.ts`, `src/zod/index.ts`, `src/standard/index.ts`, `src/standard/validate.ts` imports with imports from the new root entry point's source (`../src/index.ts`) or the deprecated barrels for tests that explicitly cover the deprecated path
- [ ] Effect fixtures wrap explicitly with `Schema.standardSchemaV1(...)` for tests targeting the new root
- [ ] Add at least one test against each deprecated barrel (`/zod`, `/effect`, `/standard`) to confirm aliases work and `/effect` still auto-wraps raw Effect schemas
- [ ] `cd packages/validate && bun test` passes

### Step 8: Build the deprecated alias barrels

- [ ] `src/zod/index.ts` rewritten as pure re-export from `../index.ts`. Every export carries `@deprecated` TSDoc with a copy-pasteable migration block. Sample:
  ```ts
  /**
   * @deprecated Since 0.1.0 — import from `@crustjs/validate` directly.
   * Will be removed in 1.0.0.
   *
   * **Migration (Zod):**
   *
   * ```ts
   * // Before
   * import { arg, flag, commandValidator } from "@crustjs/validate/zod";
   *
   * // After
   * import { arg, flag, commandValidator } from "@crustjs/validate";
   * ```
   *
   * No other code changes needed — Zod 4 schemas implement Standard Schema v1
   * natively and continue to be introspected for `type`, `required`, `default`,
   * and `description`.
   *
   * See: https://crustjs.com/docs/modules/validate#migration-0-1-0
   */
  export { arg } from "../index.ts";
  // ... (one block per re-export)
  ```
- [ ] `src/standard/index.ts` rewritten as pure re-export from `../index.ts`. `@deprecated` TSDoc on every export.
- [ ] `src/effect/index.ts` rewritten with the **auto-wrap shim**. The deprecated `arg`, `flag`, and `commandValidator` from this barrel:
  - Accept raw Effect schemas (detected via `Schema.isSchema()`)
  - Wrap internally with `Schema.standardSchemaV1()` and forward to the new root API
  - Carry `@deprecated` TSDoc with migration text that recommends manual wrapping after the import-path change
  - Re-export `promptValidator`, `parsePromptValue`, `parsePromptValueSync`, `field`, `fieldSync` as pure re-exports (these already required user wrapping today, no shim needed)
- [ ] Add minimal tests for the three deprecated barrels (or fold into Step 7 cross-target test):
  - `/zod` barrel works for a sample Zod-based command
  - `/effect` barrel auto-wraps and works for a sample Effect command using raw `Schema.Number`
  - `/standard` barrel works for any Standard Schema
- [ ] `cd packages/validate && bun test` passes

### Step 9: Update package.json

- [ ] Single `.` export plus three deprecated subpath exports (`./zod`, `./effect`, `./standard`) all pointing to their respective barrel files in `dist/`
- [ ] Bump `version` to `0.1.0`
- [ ] Move `zod` from `peerDependencies` (and `peerDependenciesMeta`) to `devDependencies` only
- [ ] Keep `effect` in `peerDependencies` with floor `^3.14.0` (note: the repo currently has `^3.19.0`; raise the floor in peerDeps too if currently lower)
- [ ] Keep `effect` in `peerDependenciesMeta` as optional
- [ ] Keep `@crustjs/core` and `typescript` in peerDeps unchanged
- [ ] Keep `@standard-schema/spec` as a runtime dependency
- [ ] `bun install` clean

### Step 10: Update package README

- [ ] Rewrite `packages/validate/README.md`. Sections:
  - Overview — Standard Schema-first; library-agnostic at the public boundary; auto-introspection for Zod and Effect under the hood
  - Install
  - **Quick start (Zod)** — minimal example using raw Zod schemas with auto-inferred metadata
  - **Quick start (Effect)** — minimal example with `Schema.standardSchemaV1()` wrap; show the optional `earg`/`eflag` helper recipe
  - **Quick start (other Standard Schema)** — minimal example with explicit `options.type` etc.
  - Command validation, prompt validation, store validation
  - Validation errors
  - **Migration from 0.0.x → 0.1.0** — clear before/after import diff, before/after Effect wrap diff, deprecation timeline (subpaths kept until 1.0.0)
  - Constraints (Effect ≥ 3.14 floor for the new root API)
- [ ] Remove the old "Architecture" / "Target Matrix" / "Entry Points" tables — there is one entry point now plus deprecated aliases

### Step 11: Update docs site and cross-package READMEs

- [ ] Rewrite `apps/docs/content/docs/modules/validate.mdx` to mirror the package README
- [ ] Update `apps/docs/content/docs/modules/index.mdx` if it tabulates validate's entry points
- [ ] Update `apps/docs/content/docs/modules/prompts.mdx` example imports (replace `@crustjs/validate/zod` and `/effect` with `@crustjs/validate`)
- [ ] Update `apps/docs/content/docs/modules/store.mdx` example imports (line ~306)
- [ ] Update `packages/store/README.md` example imports (lines 320 and 350)
- [ ] Repo-wide grep confirms no stale `@crustjs/validate/{zod,effect,standard}` imports outside the deprecated barrels themselves and `CHANGELOG.md`:
  ```sh
  grep -rn "@crustjs/validate/" --include="*.md" --include="*.mdx" --include="*.ts" .
  ```

### Step 12: Code review checkpoint

> Code-review verifies the above without re-revisiting the design.

- [ ] Public exports match the Step 1 list exactly
- [ ] Vendor-dispatch registry reads `~standard.vendor`; correctly handles unknown vendors with a clear error path
- [ ] Effect introspection reads `(schema as any).ast`, not a raw Effect schema — verified for the new root API path
- [ ] Deprecated `/effect` barrel still accepts raw Effect schemas via auto-wrap shim
- [ ] All three deprecated barrels carry `@deprecated` TSDoc with migration text
- [ ] Test parity: every behavior the deleted suites verified is either covered in the new merged suite or explicitly removed (with rationale in STATUS.md Discoveries)
- [ ] `package.json` version is `0.1.0`; effect peerDep floor `^3.14.0`; zod is in devDeps only
- [ ] README and `validate.mdx` examples spot-checked end-to-end (worker mounts one example and runs it)
- [ ] Code-review APPROVE recorded in `.reviews/`

### Step 13: Add changeset

- [ ] Run `bunx changeset` and select `@crustjs/validate` with **minor** bump (0.0.15 → 0.1.0)
- [ ] Body sections:
  - **Headline**: single root entry point + deprecated subpath aliases until 1.0.0
  - **What's new**: vendor-dispatch introspection (Zod + Effect) preserves auto-`type`/`required`/`default`/`description` for both libraries through one entry point
  - **What changed (deprecation, not breaking)**: `/zod`, `/effect`, `/standard` are now `@deprecated` aliases; existing imports continue to work through the entire 0.x cycle
  - **Effect peer-dep floor**: bumped to `^3.14.0` (current Effect ≥ 3.19 satisfies; older Effect users must upgrade or stay on the deprecated `/effect` path)
  - **Removed introspection conflict checks**: the "explicit type conflicts with inferred type" / "explicit required conflicts with optional schema" errors no longer fire — explicit options always win in the new model
  - **Migration**: short before/after diff (one block for Zod, one for Effect)
  - **Why**: simpler public API, lower friction for non-Zod/Effect Standard Schema libraries

### Step 14: Testing & Verification

> ZERO test failures allowed. This step runs the FULL test suite as a quality gate.

- [ ] Run FULL test suite: `bun run test`
- [ ] Run lint: `bun run check`
- [ ] Run type-check: `bun run check:types`
- [ ] Run build: `bun run build`
- [ ] Run docs build: `bun run build --filter=docs`
- [ ] Fix all failures

### Step 15: Documentation & Delivery

- [ ] "Must Update" docs modified (verified in Step 11)
- [ ] "Check If Affected" docs reviewed
- [ ] Discoveries logged in STATUS.md

## Documentation Requirements

**Must Update:**
- `packages/validate/README.md` — full rewrite
- `apps/docs/content/docs/modules/validate.mdx` — full rewrite
- `apps/docs/content/docs/modules/prompts.mdx` — example imports
- `apps/docs/content/docs/modules/store.mdx` — example imports
- `apps/docs/content/docs/modules/index.mdx` — entry-point reference if any
- `packages/store/README.md` — example imports

**Check If Affected:**
- `apps/docs/content/docs/api/*.mdx` — search for `@crustjs/validate/`
- `apps/docs/content/docs/guide/*.mdx` — search for `@crustjs/validate/`
- Root `README.md` — package list (probably unaffected)
- `packages/validate/CHANGELOG.md` — auto-managed, do **not** hand-edit

## Completion Criteria

- [ ] All steps complete
- [ ] `bun run check && bun run check:types && bun run test && bun run build` all pass
- [ ] Plan-review APPROVE before Step 2
- [ ] Code-review APPROVE before Step 13
- [ ] Changeset present in `.changeset/`
- [ ] Spec sanity probe (Step 0) recorded with confirmed values
- [ ] No source/test/doc file references `@crustjs/validate/{zod,effect,standard}` outside the deprecated barrels themselves and `CHANGELOG.md`

## Git Commit Convention

Commits happen at **step boundaries** (not after every checkbox). All commits
for this task MUST include the task ID for traceability:

- **Step completion:** `feat(TP-007): complete Step N — description`
- **Bug fixes:** `fix(TP-007): description`
- **Tests:** `test(TP-007): description`
- **Hydration:** `hydrate: TP-007 expand Step N checkboxes`

## Do NOT

- Expand task scope — add tech debt to CONTEXT.md instead
- Skip tests
- Skip the Step 0 spec sanity probe — design correctness depends on it
- Modify framework/standards docs without explicit user approval
- Load docs not listed in "Context to Read First"
- Commit without the task ID prefix in the commit message
- Reintroduce per-library `arg()` / `flag()` / `commandValidator()` exports beyond the deprecated barrels
- Add probing-based introspection (no trial validate calls)
- Add vendor adapters beyond Zod and Effect — unknown vendors must use explicit options
- Auto-wrap Effect schemas in the **new root** API. Auto-wrap is ONLY in the deprecated `/effect` barrel.
- Modify `@crustjs/core`, `@crustjs/store`, or `@crustjs/prompts` source code
- Hand-edit `CHANGELOG.md` files
- Bump to a non-`0.1.0` version
- Remove the deprecated barrels in this task — that's a 1.0.0 task
- Drop the `effect` peer dep entirely. The new root API needs Effect ≥ 3.14 to introspect wrappers; older versions get the deprecated `/effect` shim path.

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution.
     Format:
     ### Amendment N — YYYY-MM-DD HH:MM
     **Issue:** [what was wrong]
     **Resolution:** [what was changed] -->
