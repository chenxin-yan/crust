# Task: TP-014 — Align `@crustjs/validate` public API: new `field(schema)`, rename `parsePromptValue → parseValue`, drop legacy helpers

**Created:** 2026-05-02
**Size:** L

## Review Level: 2 (Plan and Code)

**Assessment:** Public API breaking changes to a published package, plus a
new vendor-aware introspection capability (default extraction). Plan review
locks the final export list and the new `field(schema, opts?)` signature
including TypeScript narrowing into `FieldDef`. Code review verifies the
default-extraction story across vendors (Zod 4 first-class, Effect
`optionalWith({default})` only, fallback via `validate(undefined)` for
Valibot/ArkType, silent fallback when nothing recovers).
**Score:** 5/8 — Blast radius: 2 (validate package + structurally-coupled store/prompts), Pattern novelty: 1 (vendor-aware default extraction is new in this codebase), Security: 0, Reversibility: 2 (renames + deletions; pre-1.0 minor break)

## Canonical Task Folder

```
taskplane-tasks/TP-014-validate-api-alignment/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (created by the orchestrator runtime)
└── .DONE       ← Created when complete
```

## Mission

Align the `@crustjs/validate` public API so that **schema-in, typed-value-out**
is the single mental model across commands, prompts, and store. The current
surface has accumulated parallel helpers that motivated this work:

```
arg(name, schema)               → already aligned (commands)
flag(schema)                    → already aligned (commands)
field(schema)                   → returns ONLY a validator function — under-powered
parsePromptValue(schema, v)     → misleading "Prompt" prefix; not prompt-specific
parsePromptValueSync(schema, v) → sync footgun; throws TypeError on async schemas
fieldSync(schema)               → sync footgun
promptValidator(schema, opts)   → companion factory whose only differentiator
                                  was `errorStrategy: "first" | "all"`
```

After this task lands, the **locked 8-function root surface** is exactly:

```
arg, flag                       (unchanged, command DSL)
commandValidator                (unchanged, command runner)
field(schema, opts?)            (NEW SHAPE: full FieldDef factory)
parseValue(schema, v)           (renamed from parsePromptValue)
validateStandard                (low-level primitive, async)
validateStandardSync            (low-level primitive, sync)
isStandardSchema                (type guard)
```

In addition, the **deprecated subpath barrels** introduced in TP-007 as
`@deprecated` aliases until 1.0.0 (`@crustjs/validate/zod`,
`@crustjs/validate/effect`, `@crustjs/validate/standard`) are **removed in
0.2.0**, accelerating the cleanup. This follows the user's locked
"no backward compat, keep things clean" preference and supersedes
TP-007's staged-deprecation contract. The migration is mechanical
(`@crustjs/validate/zod` and `/standard` → `@crustjs/validate`; Effect
users wrap with `Schema.standardSchemaV1(...)` once before passing to
the root entry).

Public types pruned to match. The `errorStrategy` concept is dropped entirely
(prompts now render the first issue inline — see TP-013 — and `parseValue`
already throws with all issues in `CrustError.details.issues`).

The new `field(schema, opts?)` mirrors `arg(name, schema, opts?)` and
`flag(schema, opts?)`: introspection auto-derives `type` / `default` / `array` /
`description`, and the optional second arg (a `FieldOptions` record) overrides
silently when the user wants to be explicit.

```ts
// Today (verbose, schema repeated)
fields: {
  theme: {
    type: "string",
    default: "light",
    validate: field(z.enum(["light", "dark"])),
  },
}

// After (single source of truth)
fields: {
  theme: field(z.enum(["light", "dark"]).default("light")),
}
```

The dependency boundary stays clean: `@crustjs/store` does NOT gain a
dependency on `@crustjs/validate`. `field(schema)` returns a value that
structurally satisfies store's existing `FieldDef` union.

## Dependencies

- **External:** Working branch must include the merged TP-007 / PR #113
  changes (single Standard Schema root layout in `packages/validate/src/`,
  vendor-dispatch introspection registry, deprecated subpath barrels in
  `src/{zod,effect,standard}/`). The current `taskplane` branch satisfies
  this. **Not** declared as a `**Task:** TP-007` machine edge because
  TP-007 has no `.DONE` marker in this taskplane area; an active task
  edge would block `/orch TP-014` against an already-merged predecessor.

## Context to Read First

> Only list docs the worker actually needs. Less is better.

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `packages/validate/src/index.ts` — current root re-exports (will be trimmed)
- `packages/validate/src/prompt.ts` — current `promptValidator`, `parsePromptValue`, `parsePromptValueSync`. Rename `parsePromptValue` → `parseValue`; delete the others.
- `packages/validate/src/store.ts` — current `field()` (validator-only) and `fieldSync()`. Replace with the new `field(schema, opts?)` factory.
- `packages/validate/src/schema-types.ts` — `ArgOptions`, `FlagOptions` precedent for the new `FieldOptions` shape
- `packages/validate/src/introspect/registry.ts` — `inferOptions(schema, kind, label)` vendor dispatch; extend to return a default value as well
- `packages/validate/src/introspect/zod.ts` — Zod adapter; add `extractZodDefault()` walking `def.defaultValue` (Zod 4 syntax, value not function)
- `packages/validate/src/introspect/effect.ts` — Effect adapter; add `extractEffectDefault()` using `AST.getDefaultAnnotation` for `optionalWith({default})`-style schemas only
- `packages/validate/src/validate.ts` — `validateStandard`, `validateStandardSync`, `isStandardSchema`, normalization helpers (kept; relied on by the new `field()`)
- `packages/store/src/types.ts` — `FieldDef` discriminated union (lines 47–162) and `InferStoreConfig` machinery (lines 168–210). The new `field()` must return a value that fits this without changes to store
- `packages/store/src/store.ts` — `read()`/`write()`/`patch()`/`update()` flows; `applyFieldDefaults()` and `normalizeStateTypes()` continue to work on schema-driven fields with no behavioral change (schema's transform happens during the validate step, after store-side coercion — consistent with today)
- `packages/validate/README.md` — public API reference; will be substantially rewritten
- `apps/docs/content/docs/modules/validate.mdx` — public docs to update
- `packages/validate/src/prompt.test.ts` — test file for the renamed/removed helpers

**Reference research (already conducted; don't re-research unless a finding is contradicted):**
- Standard Schema v1 spec exposes only `~standard.{version, vendor, validate}` at runtime — no defaults, no type-kind. Issues #11 and #109 explicitly proposed adding these and were rejected. Source: https://standardschema.dev/schema
- Vendor-neutral default fallback: `validate(undefined)` returns the default for Zod, Valibot, ArkType. **Effect schemas using `Schema.annotations({ default })` (vs `optionalWith({ default })`) do NOT inject defaults during decode**, so `validate(undefined)` fails for them; there is no spec-portable recovery.
- Zod 4 default access: walk `schema.def` for a `ZodDefault`-shaped node and read `def.defaultValue` (a value in v4, not a function as in v3). Source: https://v4.zod.dev/packages/core?id=internals
- **`field()` is a synchronous factory.** It must return `FieldDef` directly
  (not `Promise<FieldDef>`). Therefore default extraction inside `field()`
  must complete synchronously: try vendor-aware (sync) first; for the
  vendor-neutral fallback, call `schema['~standard'].validate(undefined)`
  and use the result ONLY when it is non-Promise. If the schema's `validate`
  returns a `Promise`, return `{ ok: false }` silently — the user can pass
  `field(schema, { default: x })` explicitly. This is consistent with the
  silent-fallback design constant from the grilling session.

## Environment

- **Workspace:** `packages/validate/` (primary), `apps/docs/`
- **Services required:** None

## File Scope

**Modified:**
- `packages/validate/src/index.ts` (trim re-exports to the locked 8-function surface; remove all subpath re-export hooks)
- `packages/validate/src/store.ts` (replace `field`/`fieldSync` with the new SYNCHRONOUS `field(schema, opts?)` factory; produces a `FieldDef`)
- `packages/validate/src/parse.ts` (NEW — `parseValue` renamed/relocated from `prompt.ts`'s `parsePromptValue`; sync version dropped)
- `packages/validate/src/prompt.ts` (DELETED — `promptValidator` + `parsePromptValueSync` removed; `parsePromptValue` migrated to `parse.ts` as `parseValue`)
- `packages/validate/src/schema-types.ts` (add `FieldOptions<T>` interface; export it; re-shape any returned types as needed)
- `packages/validate/src/introspect/registry.ts` (extend the `kind` parameter of `inferOptions` from `"arg" | "flag"` to `"arg" | "flag" | "field"`; add new SYNCHRONOUS helper `extractDefault(schema): { ok: true, value: unknown } | { ok: false }` that tries vendor-aware first, falls back to `validate(undefined)` ONLY when the schema's validate returns synchronously)
- `packages/validate/src/introspect/zod.ts` (add SYNC Zod default extraction walking `def.defaultValue`)
- `packages/validate/src/introspect/effect.ts` (add SYNC Effect default extraction using `AST.getDefaultAnnotation` for `optionalWith({default})`-style schemas; documented as the supported case)
- `packages/validate/src/store.test.ts` (rewrite for the new `field()` shape; default-extraction matrix tests for Zod and Effect)
- `packages/validate/src/parse.test.ts` (NEW — moved from `prompt.test.ts`; sync test removed; test name updated)
- `packages/validate/src/prompt.test.ts` (DELETED)
- `packages/validate/README.md` (rewrite the API reference; remove dropped helpers; document the new `field()` and `parseValue`; document subpath removal in migration section)
- `apps/docs/content/docs/modules/validate.mdx` (mirror the README changes)
- `packages/validate/package.json` (bump to `0.2.0`; remove `./zod`, `./effect`, `./standard` from `exports`; remove `effect` from `peerDependencies` and `peerDependenciesMeta` since the auto-wrap shim is removed)
- `.changeset/*.md` (NEW — minor bump for `@crustjs/validate`; document the migration explicitly)

**Deleted (from src/, package.json exports, and the workspace):**
- `packages/validate/src/zod/index.ts` (subpath barrel — deprecated alias from TP-007 removed in 0.2.0)
- `packages/validate/src/effect/index.ts` (subpath barrel + auto-wrap shim — the runtime `isSchema()`/`standardSchemaV1()` calls go away with the file)
- `packages/validate/src/standard/index.ts` (subpath barrel — deprecated alias removed in 0.2.0)
- `packages/validate/src/zod/` (entire directory — the `command.ts`, `schema.ts`, `types.ts` subfiles too if any remain)
- `packages/validate/src/effect/` (entire directory)
- `packages/validate/src/standard/` (entire directory)

**Removed exports (deletions in same commit as the rename):**
- `parsePromptValue`, `parsePromptValueSync` exports — replaced by `parseValue`
- `promptValidator` export and `PromptErrorStrategy`, `PromptValidatorOptions` types
- Old `field` (validator-only function) and `fieldSync` exports — replaced by the new `field(schema, opts?)` factory
- All three subpath barrels (`/zod`, `/effect`, `/standard`) and their `package.json` `exports` entries

## Steps

> **Hydration:** STATUS.md tracks outcomes, not individual code changes.
> Workers expand steps when runtime discoveries warrant it.

### Step 0: Preflight

- [ ] Required files and paths exist
- [ ] Test suite green pre-edit: `bun run --cwd packages/validate test`
- [ ] Confirm TP-013 has not yet introduced any cross-package coupling that would conflict (it shouldn't — TP-013 only adds a polymorphic slot to prompts and uses `@standard-schema/spec` directly)

### Step 1: Add `FieldOptions<T>` to `schema-types.ts`

> **Locked design** (from grilling session):
> - Mirror `ArgOptions` / `FlagOptions` shape: every key optional, explicit values silently override introspection.
> - Keys: `type`, `description`, `default`, `array`. NO `validate` key (validation flows through the schema itself; if users want extra checks, use `.refine()` / `Schema.filter()` on the schema).
> - The generic parameter is the schema's output type; the `default` key uses it for type-tightness.

- [ ] Add `FieldOptions<T = unknown>` interface to `packages/validate/src/schema-types.ts` mirroring `ArgOptions` / `FlagOptions` style and TSDoc tone
- [ ] Re-export `FieldOptions` from `packages/validate/src/index.ts` types block

**Artifacts:**
- `packages/validate/src/schema-types.ts` (modified)
- `packages/validate/src/index.ts` (modified)

### Step 2: Implement SYNCHRONOUS vendor-aware default extraction

> **Locked design**:
> - The factory `field(schema, opts?)` is **synchronous**: it returns `FieldDef`,
>   not `Promise<FieldDef>`. Therefore `extractDefault` must also be synchronous.
> - Try vendor-aware first: Zod walks `schema.def` looking for the `ZodDefault`
>   node and reads `def.defaultValue` (sync). Effect uses
>   `AST.getDefaultAnnotation` (sync) and only handles the
>   `optionalWith({default})`-style case.
> - Fallback: call `schema['~standard'].validate(undefined)` and inspect the
>   return. If the result is a `Promise`, return `{ ok: false }` silently —
>   the user can pass `field(schema, { default: x })` explicitly. If the
>   result is synchronous and has no `issues`, return
>   `{ ok: true, value: result.value }`. **Do NOT use `result.value === undefined`
>   as the "no default" signal** — falsy defaults (`false`, `""`, `0`) are
>   valid; check `result.issues` instead.
> - When extraction fails (Effect annotation-only, async-only schemas,
>   schemas without any default), return `{ ok: false }` and let `field()`
>   produce a FieldDef WITHOUT a `default` key. **Silent fallback** — no
>   warn, no throw.

- [ ] Extend the `kind` parameter of `inferOptions(schema, kind, label)` in `packages/validate/src/introspect/registry.ts` from `"arg" | "flag"` to `"arg" | "flag" | "field"` (the `"field"` case enables the same type/array/description introspection used by `arg`/`flag`)
- [ ] Add `extractDefault(schema): { ok: true, value: unknown } | { ok: false }` to `packages/validate/src/introspect/registry.ts` (synchronous return type)
- [ ] Implement Zod path in `introspect/zod.ts`: walk `def` for `ZodDefault` (in Zod 4, the `type` discriminator may be `"default"`); return `def.defaultValue` (NOT a function call)
- [ ] Implement Effect path in `introspect/effect.ts`: call `AST.getDefaultAnnotation(schema.ast)`; if `Option.isSome`, return its inner value
- [ ] Implement vendor-neutral sync fallback: call `schema['~standard'].validate(undefined)`. If the return is `instanceof Promise`, return `{ ok: false }`. Otherwise, if no `issues`, return `{ ok: true, value: result.value }`; otherwise `{ ok: false }`.
- [ ] Tests in `store.test.ts` (the test file exercising the new `field()`):
  - Zod: `z.string().default("x")` → extracts `"x"`
  - Zod: `z.boolean().default(false)` → extracts `false` (falsy default detection)
  - Zod: `z.string()` (no default) → returns `{ ok: false }`
  - Async-only schema (sync fallback path returns `{ ok: false }`): `z.string().refine(async () => true).default("x")` (or any schema whose `~standard.validate` returns Promise) → returns `{ ok: false }` silently
  - Effect: `Schema.optionalWith(Schema.String, { default: () => "x" })` → extracts `"x"`
  - Effect: `Schema.String.annotations({ default: "x" })` → returns `{ ok: false }` (documented limitation)
  - Valibot (if Valibot is available as a dev dep, or skip): `v.optional(v.string(), "x")` → extracts `"x"`

**Artifacts:**
- `packages/validate/src/introspect/registry.ts` (modified)
- `packages/validate/src/introspect/zod.ts` (modified)
- `packages/validate/src/introspect/effect.ts` (modified)
- `packages/validate/src/store.test.ts` (modified — new tests)

### Step 3: Implement the new `field(schema, opts?)` factory

> **Locked design**:
> - Signature: `function field<S extends StandardSchema>(schema: S, opts?: FieldOptions<InferOutput<S>>): FieldDef` — **synchronous return**.
> - Auto-derive `type`, `array`, `description` from `inferOptions(schema, "field", label)`.
> - Auto-derive `default` from `extractDefault(schema)` (Step 2). On `{ ok: false }`, omit the `default` key.
> - Each `opts` key wins silently over introspection (matches `arg`/`flag` precedent).
> - Auto-attach `validate: (v) => Promise<void>` from the schema (re-using the existing `validateStandard` + `throwValidationError` path).
> - Throw `CrustError("DEFINITION")` ONLY when `type` cannot be resolved at all (consistent with `arg()`/`flag()`). Default extraction failure is silent.
>
> **TypeScript narrowing rules — these are intentionally limited:**
> - The returned object's `type` field narrows from `InferOutput<S>` to a
>   literal (`"string"` | `"number"` | `"boolean"`) so `InferStoreConfig`
>   produces the correct primitive type for each field. Use conditional
>   types or function overloads to encode this.
> - **Schema-derived runtime defaults do NOT narrow the TypeScript type.**
>   Standard Schema v1 has no spec-portable type-level access to defaults,
>   so `field(z.string().default("x"))` returns a value whose TS type does
>   NOT include `default: "x"` as a required property. Persisted state
>   types as `string | undefined` even though the runtime default is `"x"`.
>   This is a documented limitation, not a bug.
> - **Explicit defaults via `opts.default` DO narrow.** `field(schema, { default: x })`
>   returns a value whose TS type includes `default: T`, so persisted state
>   types as `T` (no `| undefined`). Users who want tight typing for a
>   default-bearing field pass it explicitly.

- [ ] Replace `field()` and delete `fieldSync()` in `packages/validate/src/store.ts`
- [ ] Implement using function overloads (preferred for clarity over deeply-nested conditional types):
  - `field<S>(schema: S): SchemaFieldDef<S>` (no opts)
  - `field<S, T extends InferOutput<S>>(schema: S, opts: FieldOptions<T> & { default: T }): SchemaFieldDefWithDefault<S, T>` (default supplied via opts — narrows)
  - `field<S>(schema: S, opts: FieldOptions<InferOutput<S>>): SchemaFieldDef<S>` (other opts — no default narrowing)
- [ ] Verify by writing a sample `createStore({ fields: { theme: field(z.enum(["light","dark"]).default("light")) } })` smoke. The runtime default works; the TS state types as `"light" | "dark" | undefined`. Compare with `createStore({ fields: { theme: field(z.enum(["light","dark"]), { default: "light" }) } })` which types as `"light" | "dark"`.
- [ ] Tests:
  - Runtime: `field(z.string().default("x"))` → produces `{ type: "string", default: "x", validate: ... }` at runtime (introspection succeeded)
  - Type level: same call's TS state types as `string | undefined` (NOT `string`) — documented limitation
  - Runtime: `field(z.string())` (no default) → `{ type: "string", validate: ... }`; TS state `string | undefined`
  - Runtime + type: `field(z.string(), { default: "y" })` → default is `"y"`; TS state `string` (narrowed via opts)
  - Runtime + type: `field(z.string().default("x"), { default: "y" })` → opts wins; default is `"y"`; TS state `string`
  - Runtime: `field(z.array(z.string()).default([]))` → `{ type: "string", array: true, default: [], validate: ... }`
  - `field(z.string()).validate("x")` resolves; `.validate(123)` rejects with structured issues
  - End-to-end against `createStore({ fields: { theme: field(...) } })` — `read()`, `write()`, `patch()` all behave correctly

**Artifacts:**
- `packages/validate/src/store.ts` (rewritten)
- `packages/validate/src/store.test.ts` (modified — covers the matrix above)

### Step 4: Rename `parsePromptValue` → `parseValue` and prune `prompt.ts`

> **Locked design**:
> - `parseValue(schema, v): Promise<InferOutput<S>>` — async only. Sync version dropped (use `validateStandardSync` directly if a sync path is genuinely needed).
> - `promptValidator` deleted — schema-as-validate is now native to prompts (TP-013).
> - `errorStrategy` concept gone everywhere. `parseValue` throws `CrustError("VALIDATION")` with all issues in `details.issues` (existing behavior).

- [ ] Create `packages/validate/src/parse.ts` with `parseValue` (lifted from `prompt.ts`'s `parsePromptValue`; identical body, function renamed)
- [ ] Delete `packages/validate/src/prompt.ts`
- [ ] Update `packages/validate/src/index.ts` to export `parseValue` from `parse.ts`; remove `parsePromptValue`, `parsePromptValueSync`, `promptValidator` exports; remove `PromptErrorStrategy`, `PromptValidatorOptions` type exports
- [ ] Move `prompt.test.ts` → `parse.test.ts`; trim sync tests; rename function references; keep the throw-on-invalid coverage (CrustError + details.issues)
- [ ] Update any internal usage in the validate package source (commandValidator, etc.) — likely none, but verify with `rg "parsePromptValue|promptValidator|parsePromptValueSync"` returning empty

**Artifacts:**
- `packages/validate/src/parse.ts` (new)
- `packages/validate/src/prompt.ts` (deleted)
- `packages/validate/src/parse.test.ts` (new — relocated from `prompt.test.ts`)
- `packages/validate/src/prompt.test.ts` (deleted)
- `packages/validate/src/index.ts` (trimmed exports)

### Step 5: Delete deprecated subpath barrels and clean up package metadata

> **Locked decision (supersedes TP-007's staged-deprecation through 1.0.0):**
> the user's "no backward compat, keep things clean" preference applies
> here too. The subpath barrels go away in 0.2.0, not 1.0.0.

- [ ] Delete `packages/validate/src/zod/` (entire directory: `index.ts` and any siblings)
- [ ] Delete `packages/validate/src/effect/` (entire directory — the auto-wrap shim disappears with it; runtime imports `Schema.isSchema`/`standardSchemaV1` from `effect/Schema` are gone)
- [ ] Delete `packages/validate/src/standard/` (entire directory)
- [ ] In `packages/validate/package.json`:
  - Remove `./zod`, `./effect`, `./standard` from `exports`
  - Remove `effect` from `peerDependencies` and `peerDependenciesMeta` — with the auto-wrap shim gone, validate has zero runtime imports from `effect`. The user is responsible for installing Effect themselves if they wrap schemas with `Schema.standardSchemaV1(...)`.
  - Confirm the static-effect-import regression test (`tests/no-static-effect-import.test.ts`) still passes — it should, since the deletions only tighten the no-effect-imports invariant

### Step 6: Cross-package usage check

> Once exports change, any consumer in this monorepo that referenced the old names or subpaths breaks. Audit and fix.

- [ ] `rg "parsePromptValue|parsePromptValueSync|promptValidator|fieldSync" --type ts` across the entire monorepo (excluding `apps/demo-validate/`, which is owned by TP-015)
- [ ] `rg "@crustjs/validate/(zod|effect|standard)" --type ts --type md --type mdx` across the entire monorepo — every hit is a stale subpath import that must be updated to the root entry (or deferred to TP-015 if it lives in demo)
- [ ] For each hit outside `packages/validate/`: update to the new name/path OR document that it lives in `apps/demo-validate/` and is intentionally deferred
- [ ] Ensure `@crustjs/store` and `@crustjs/prompts` packages do not reference `@crustjs/validate` runtime exports beyond what's structurally compatible (they shouldn't — store has zero validate dep; prompts gained `@standard-schema/spec` only in TP-013)

**Artifacts:**
- Whatever consumer files surface

### Step 7: Documentation

- [ ] Rewrite `packages/validate/README.md` to describe the **locked 8-function root surface**. Lead with the unified mental model: schema in, typed value out. Show the four DSL shapes side-by-side: `arg(name, schema)`, `flag(schema)`, `field(schema, opts?)`, `parseValue(schema, v)`, plus the prompts integration (`input({ validate: schema })` cross-link to `prompts.mdx`).
- [ ] Mirror the rewrite in `apps/docs/content/docs/modules/validate.mdx`.
- [ ] Add a clear "Migrating from 0.1.x" section to BOTH documenting the renames, deletions, and subpath removal:
  - **Subpaths removed:** `@crustjs/validate/zod` and `@crustjs/validate/standard` → `@crustjs/validate` (single root entry). `@crustjs/validate/effect` → `@crustjs/validate`, plus users now wrap their Effect schemas explicitly with `Schema.standardSchemaV1(…)` once before passing to the root entry (the auto-wrap shim is gone). The `effect` peer dependency is removed; users install `effect` themselves at their preferred version.
  - `parsePromptValue` → `parseValue` (sed: `s/parsePromptValue\b/parseValue/g`)
  - `parsePromptValueSync` → use `validateStandardSync` directly + handle the result
  - `promptValidator(schema)` → pass schema directly to `input({ validate: schema })` (per TP-013); for non-prompt validator-shape consumers, write `(v) => validateStandard(schema, v).then(r => r.ok ? true : r.issues[0]?.message ?? "Validation failed")`
  - Old `field(schema)` (validator-only) → use the new `field(schema)` (returns a full FieldDef); if you really need a bare validator, use `(v) => validateStandard(schema, v).then(r => { if (!r.ok) throw … })`
  - `fieldSync` → use `field(schema)` with sync schemas; the resulting validator is async but lightweight
  - **Schema-derived defaults and TypeScript:** `field(schema.default(x))` produces a runtime default but the TS state types as `T | undefined`. For tight typing, pass `field(schema, { default: x })` explicitly.
- [ ] Add a changeset: minor bump for `@crustjs/validate`. Description should enumerate the breaking changes in a single paragraph for the GitHub release notes (subpath removal, helper renames, helper deletions, `field()` shape change, `effect` peer dep removal).

**Artifacts:**
- `packages/validate/README.md` (rewritten)
- `apps/docs/content/docs/modules/validate.mdx` (rewritten)
- `.changeset/<auto-name>.md` (new)

### Step 8: Testing & Verification

> ZERO test failures allowed. This step runs the FULL test suite as a quality gate.

- [ ] `bun run check` (Biome) clean
- [ ] `bun run check:types` clean across all packages
- [ ] `bun run test` full suite green (the regression test in `tests/no-static-effect-import.test.ts` still passes — both Effect and Zod stay out of the root import graph; `@standard-schema/spec` is allowed as it's already an existing dep). With the `/effect` shim deleted, this test should pass MORE strictly now.
- [ ] `bun run build` succeeds for `@crustjs/validate`
- [ ] `rg "@crustjs/validate/(zod|effect|standard)"` returns no hits anywhere in the monorepo

### Step 9: Documentation & Delivery

- [ ] All "Must Update" docs modified
- [ ] "Check If Affected" docs reviewed (see below)
- [ ] Discoveries logged in STATUS.md (esp. any vendor introspection edge cases hit during default extraction)
- [ ] Verify the final **8-function root surface** matches the locked list in this PROMPT (one final `rg "^export" packages/validate/src/index.ts` pass)

## Documentation Requirements

**Must Update:**
- `packages/validate/README.md` — full rewrite for the new surface + migration section
- `apps/docs/content/docs/modules/validate.mdx` — mirror
- `.changeset/*.md` — minor bump with explicit migration notes

**Check If Affected:**
- `packages/store/README.md` — currently uses `field(schema)` validator-only pattern; the new `field(schema)` returns a different shape. Update examples to the new shape OR mark them as legacy with a forward link to the new docs. Coordinate cross-link verification with TP-015.
- `apps/docs/content/docs/modules/store.mdx` — same as store README
- `apps/docs/content/docs/modules/prompts.mdx` — was updated by TP-013 with the polymorphic `validate:` slot; verify the `@crustjs/validate` cross-references still resolve after this PR's renames

## Completion Criteria

- [ ] All steps complete
- [ ] All tests passing (workspace-wide)
- [ ] Public exports match the locked 8-function root surface exactly (`arg`, `flag`, `commandValidator`, `field`, `parseValue`, `validateStandard`, `validateStandardSync`, `isStandardSchema`)
- [ ] Documentation updated with explicit migration section
- [ ] Changeset created (minor bump)

## Git Commit Convention

Commits happen at **step boundaries** (not after every checkbox). All commits
for this task MUST include the task ID for traceability:

- **Step completion:** `feat(TP-014)!: complete Step N — description` (note the `!` to mark breaking changes, per Conventional Commits)
- **Bug fixes:** `fix(TP-014): description`
- **Tests:** `test(TP-014): description`
- **Hydration:** `hydrate: TP-014 expand Step N checkboxes`

## Do NOT

- Add a `validate` key to `FieldOptions`. Validation flows through the schema
  exclusively. If users want extra checks, they refine the schema. This is a
  locked decision from the design grill.
- Expose any `errorStrategy` option. The concept is gone everywhere — prompts
  render the first issue (TP-013); `parseValue` throws with all issues in
  `details.issues` (existing behavior). No toggle.
- Add a sync version of `parseValue`. Keep `validateStandardSync` as the only
  sync escape hatch for users who genuinely need it.
- Add `@crustjs/validate` as a runtime dependency to `@crustjs/store` or
  `@crustjs/prompts`. The structural-typing decoupling is preserved.
- Try to type-narrow `field()` return based on whether the schema has a
  `.default()` at the type level. Standard Schema does not expose defaults at
  the type level portably; users who want tight `T` (vs `T | undefined`) for
  default-bearing fields can pass `field(schema, { default: x })` explicitly.
  This is documented as a known limitation.
- Modify `apps/demo-validate/`. The demo rewrite is owned by TP-015.
- Modify `packages/prompts/`. Prompt-side changes (polymorphic `validate:`
  slot) are owned by TP-013.
- Expand task scope — log tech debt to `taskplane-tasks/CONTEXT.md#tech-debt--known-issues` instead.
- Skip tests
- Modify framework/standards docs without explicit user approval
- Commit without the task ID prefix in the commit message

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution.
     Format:
     ### Amendment N — YYYY-MM-DD HH:MM
     **Issue:** [what was wrong]
     **Resolution:** [what was changed] -->

### Amendment 1 — 2026-05-03 (supervisor pre-flight, post PR #113)
**Issue:** PR #113 (TP-007) merged the introspection registry at
`packages/validate/src/introspect/registry.ts` with `inferOptions(schema,
kind, label)` returning `InferredOptions` (`type`, `multiple`,
`description`, `optional`). The registry does **NOT** include any
`extractDefault()` machinery, and the `kind` parameter is currently
`"arg" | "flag"` only.
**Resolution:** TP-014 must extend the registry to add:
  1. `extractDefault(schema): { ok: true; value: unknown } | { ok: false }`
     — vendor-aware default extraction (Zod first-class via `def` walk
     for `ZodDefault`; Effect via `AST.getDefaultAnnotation`; Valibot/
     ArkType fallback via sync `validate(undefined)` with `Promise`
     rejection → `{ ok: false }`).
  2. Extend the `kind` union to include `"field"` so `inferOptions(schema,
     "field", label)` is callable from the new `field(schema, opts?)`
     factory.
Both additions are within TP-014's locked scope (Step 2 already plans
for them) — this amendment just makes the post-PR-#113 baseline
explicit so the worker doesn't expect `extractDefault()` to already
exist.

**Confirmed legacy helpers still present in `packages/validate/src/index.ts`
as of 2026-05-03 (all targeted for deletion per locked surface):**
  - `parsePromptValue` → rename to `parseValue`
  - `parsePromptValueSync` → delete
  - `promptValidator` → delete
  - `fieldSync` (in `store.ts`) → delete
  - `PromptErrorStrategy`, `PromptValidatorOptions` types → delete
  - Deprecated subpath barrels `./zod`, `./effect`, `./standard` (in
    both `src/` and `package.json` `exports`) → remove

**Source:** Scout verification 2026-05-03, `.pi/supervisor/scout-reports/TP-014.md`.
