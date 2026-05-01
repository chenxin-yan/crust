# Task: TP-018 — `@crustjs/store` persists schema transforms with a read-stability guard

**Created:** 2026-05-07
**Scope reduced:** 2026-05-12 (Amendment 2 — operator dropped polymorphic `FieldSpec` + `store.fields()` API from scope; this PROMPT is the lean rewrite)
**Size:** M

## Review Level: 2 (Plan + Code)

**Assessment:** Single-package behavior change inside `@crustjs/store`. The
runtime rewrite is small and well-bounded (~80 LOC in `store.ts` +
`field.ts`); the design is locked from the prior grilling session; tests
are failing-tests-first. Plan review locks the
`{ value }`-return contract on `FieldDef.validate` and the read-stability
test matrix; code review verifies the schema path matches the command
path's parse-and-use-`result.value` semantics
(`packages/validate/src/middleware.ts:100-140`) exactly.
**Score:** 4/8 — Blast radius: 1 (`@crustjs/store` only — `@crustjs/validate`
was already updated by PR #123), Pattern novelty: 1 (write-time transform
persistence + read-stability guard is new in this codebase, but follows the
command-path pattern), Security: 0, Reversibility: 2 (transformed values
are canonicalized once on next write — existing files survive unchanged,
but transformed-output round-trip is a behavior change; pre-1.0 minor
break with explicit migration note).

## Canonical Task Folder

```
taskplane-tasks/TP-018-store-schema-transforms-and-fields-api/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (created by the orchestrator runtime)
└── .DONE       ← Created when complete
```

## Mission

Close the **command/store asymmetry** in Crust's validation story for the
common case: schema-driven transforms must persist on `write` / `update` /
`patch`. Today, the command path holds a Standard Schema directly on each
`ArgDef$` / `FlagDef$`, runs `schema["~standard"].validate(raw)` inline in
`buildValidatedRunner`, and hands the **transformed** `result.value` to the
user's command handler (`packages/validate/src/middleware.ts:100-140`). The
store path, in contrast, runs the schema purely for its throw/no-throw
signal and **discards `result.value`** — so
`field(z.string().transform(s => s.trim()))` validates a trimmed-passing
input but persists the original untrimmed value. The currently documented
behavior at `apps/docs/content/docs/modules/store.mdx:345-346` ("Schema
transforms/coercions … are not written back") confirms the intent of this
gap, but parity with the command path is the right destination — and the
documented limitation is the bug we're closing.

After this task lands:

- Schema-driven transforms persist on `write` / `update` / `patch`. Reads
  return what's on disk verbatim (no transform on read; consistent with
  the locked design from the design grilling).
- A **read-stability re-validation** runs at write time when the transform
  changed the value: store calls
  `schema["~standard"].validate(transformedValue)` once more and rejects
  the write if the transformed output would fail the next read. This
  catches cross-type transforms like `z.string().transform(Number)` at
  write time rather than read time.
- Plain literal `FieldDef`s with a hand-rolled `validate: (v) => { ... }`
  callback keep their current contract exactly. They return `void` (or
  `Promise<void>`) to accept, throw to reject; the migration guard in
  `runFieldValidators` is preserved for that shape.

**Explicitly out of scope** (deferred / dropped per operator decision
2026-05-12):

- **Polymorphic `FieldSpec`** — users keep wrapping schemas with `field()`.
  No new `FieldDef | StandardSchemaV1` union; no `literalToSchema()`
  adapter; no `InferStoreConfig` branching; `normalizeStateTypes` /
  `coerceByType` stay.
- **`store.fields()` introspection API** — no `StoreFieldMetadata`
  type; no per-field metadata cache; no new method on the `Store<TConfig>`
  interface. Deferred until a real consumer exists (e.g. a future
  `configPlugin` that auto-generates flags from a store).
- **`@crustjs/validate` surface contraction** — already shipped by PR #123;
  no further changes there.
- **Explicit `@standard-schema/spec` dep on `@crustjs/store`** — still
  transitive via `@crustjs/schema-utils`; no upgrade needed for the
  reduced scope (the only schema-typed surface we introduce is the
  internal validate-result shape, which can be locally typed).

## Dependencies

- None. PR #123 (TP-017 + field() migration) is merged on `main`.

## Context to Read First

> Only list docs the worker actually needs. Less is better.

**Tier 2 (area context):**

- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**

- `packages/validate/src/middleware.ts` (lines 100-140) — **canonical**
  schema-parse-then-use-`result.value` pattern. The new store runtime must
  mirror this exactly: capture `r.value`, persist it, re-validate it before
  persisting. No new patterns.
- `packages/store/src/store.ts` (lines 112-150) — current `runFieldValidators`
  body; the migration-guard `TypeError` at line 145 is the explicit point
  of change.
- `packages/store/src/field.ts` — current `field()` helper; the `makeValidator`
  factory currently throws on issues and returns `void` on success. After
  this task, `makeValidator` returns `{ value: result.value }` on success so
  `runFieldValidators` can persist transforms.
- `packages/store/src/store.test.ts` — current store tests. The failing-
  tests-first chunk in Step 1 lands here.
- `apps/docs/content/docs/modules/store.mdx` (lines 345-346) — the
  documented "validation-only" statement that this task inverts.
- `packages/store/README.md` — public landing; mirrors mdx change.

## Environment

- **Workspace:** `packages/store/` (only — `validate` is untouched in this
  scoped-down version), `apps/docs/`, package README
- **Services required:** None

## File Scope

**Modified — `@crustjs/store`:**

- `packages/store/src/field.ts`:
  - Update `makeValidator<S>(schema)` to return
    `Promise<{ value: unknown } | void>` instead of `Promise<void>`.
    On schema success, return `{ value: result.value }`. On issues, throw
    as today.
  - No public surface change. The `FieldDef.validate` returned in the
    helper's body still typechecks as the (now widened) FieldDef contract.
- `packages/store/src/types.ts`:
  - Widen `FieldDef.validate` from
    `(value: T) => void | Promise<void>` to
    `(value: T) => void | Promise<void> | { value: T } | Promise<{ value: T }>`.
    Plain-literal users who write `validate: (v) => { if (...) throw }` are
    unaffected (returning `void` is still valid).
  - Document the new shape inline.
- `packages/store/src/store.ts`:
  - Replace the migration-guard `TypeError` block at ~lines 144-149 with
    the schema-aware persistence flow:
    ```ts
    if (result === undefined) continue;  // void return → validation-only
    if (typeof result === "object" && result !== null && "value" in result) {
      const transformed = (result as { value: unknown }).value;
      const isPersistOp = operation !== "read";
      if (isPersistOp && !Object.is(transformed, value)) {
        // Read-stability guard: re-validate the transformed output
        try {
          const recheck = await def.validate(transformed as never);
          // Recheck must succeed (void or { value: transformed })
          if (
            recheck !== undefined &&
            (typeof recheck !== "object" ||
              recheck === null ||
              !("value" in recheck) ||
              !Object.is((recheck as { value: unknown }).value, transformed))
          ) {
            issues.push({
              message: `read-unstable transform (output would fail re-validation)`,
              path: key,
            });
            continue;
          }
        } catch (cause) {
          const message =
            cause instanceof Error ? cause.message : "Re-validation failed";
          issues.push({
            message: `read-unstable transform: ${message}`,
            path: key,
          });
          continue;
        }
        record[key] = transformed;
      }
      continue;
    }
    throw new TypeError(
      `FieldDef.validate must return void or { value }. ...`,
    );
    ```
  - Note: `read` operations DO call validators (current behavior; see
    `read()` at line ~190 invoking `runFieldValidators(merged, "read")`),
    but the persist-and-restability branch only runs for non-read ops.
    A schema that transforms on read therefore validates successfully on
    read but does not mutate `record[key]`. This matches the locked design.
- `packages/store/src/store.test.ts`:
  - **Failing-tests-first** additions in Step 1 (see Steps section).
- `packages/store/README.md`:
  - Replace any "validation-only" / "not written back" language with the
    new write-time transform contract + read-stability requirement.

**Modified — docs:**

- `apps/docs/content/docs/modules/store.mdx` (lines 345-346):
  - Replace the "Schema transforms/coercions … are not written back"
    paragraph with the new contract: transforms apply on
    `write` / `update` / `patch`; reads return on-disk values verbatim;
    cross-type transforms that would fail re-validation are rejected at
    write time as `read-unstable transform`.

**Changeset:**

- `.changeset/<timestamped>.md` (NEW — single changeset):
  - `@crustjs/store`: minor bump.
    - Schema-driven transforms now persist on `write` / `update` /
      `patch` (e.g. `z.string().transform(s => s.trim())` writes the
      trimmed value to disk).
    - New write-time **read-stability guard**: a transform whose output
      would fail the schema's own re-validation (e.g.
      `z.string().transform(Number)` — input string, output number) is
      rejected at write time with a `VALIDATION` error tagged
      `read-unstable transform`.
    - **Behavior change:** existing on-disk values for schema-using
      stores survive unchanged on `read`. The first subsequent `write`
      canonicalizes them through the transform. Document the trim example
      explicitly.
    - `FieldDef.validate` return contract widened from `void` to
      `void | { value }`. Plain-literal users (`validate: (v) => { ... }`
      returning `void`) are unaffected.

**Explicitly NOT modified:**

- `@crustjs/validate` — already locked at 7 functions by PR #123. Out
  of scope.
- `packages/store/src/types.ts` `FieldsDef` — stays
  `Record<string, FieldDef>`. No polymorphic union.
- `Store<TConfig>` interface — no `fields()` method added.
- `normalizeStateTypes` / `coerceByType` — keep as-is; plain-literal
  coercion behavior is unchanged.

## Steps

> **Hydration:** STATUS.md tracks outcomes, not individual code changes.
> Workers expand steps when runtime discoveries warrant it.

### Step 0: Preflight

- [ ] Required files and paths exist
- [ ] PR #123 baseline confirmed:
  - `packages/store/src/field.ts` exists with three overloads
  - `packages/store/src/field.test.ts` exists with 30 tests
  - `@crustjs/validate` exports 7 functions (no `field` export)
- [ ] Pre-edit test suite green:
      `bun run --cwd packages/store test`
      `bun run --cwd packages/store check:types`

### Step 1: Failing-tests-first — pin the asymmetry

> Three RED tests and two GREEN/pin tests. **Expected RED** must fail today;
> **expected GREEN / pin** must already pass and lock current behavior
> before refactor. Do NOT proceed to Step 2 until red tests are visibly
> failing in the worker's pre-implementation run.

- [ ] **RED:** Zod transform persists on write — use
      `field(z.string().transform(s => s.trim()))`, call
      `store.write({ name: "  hi  " })`, assert the on-disk JSON file
      contains `{ name: "hi" }` (read via raw `Bun.file().json()`)
- [ ] **RED:** Read does NOT transform — pre-seed the JSON file with
      `{ name: "  hi  " }`, same trimming schema; assert `store.read()`
      returns `{ name: "  hi  " }` AND the file on disk is unchanged
      after the read
- [ ] **RED:** Read-stability guard rejects cross-type transforms — use
      `field(z.string().transform(Number))` or similar; assert
      `store.write({ x: "42" })` throws `CrustStoreError("VALIDATION")`
      with the issue message containing `read-unstable transform`; assert
      nothing was written to disk
- [ ] **GREEN/pin:** Plain literal still works — `{ type: "string",
      default: "x" }` end-to-end (existing tests should already cover this;
      add an explicit pin assertion that the JSON on disk equals the input)
- [ ] **GREEN/pin:** Hand-rolled `validate: (v) => { ... }` callback
      returning `void` still rejects on throw and accepts on no-throw
      (pin existing behavior)
- [ ] Run targeted tests; confirm RED tests fail and GREEN/pin tests pass
      before continuing
- [ ] Commit at step boundary: `test(TP-018): pin store transform-
      persistence asymmetry with failing tests`

**Artifacts:**
- `packages/store/src/store.test.ts` (modified — new test cases)

### Step 2: Widen `FieldDef.validate` contract; update `field()` helper

- [ ] In `packages/store/src/types.ts`, widen `FieldDef.validate` to
      `(value: T) => void | Promise<void> | { value: T } | Promise<{ value: T }>`.
      Add a TSDoc comment explaining the two return shapes:
      - `void` (or `undefined`) → validation-only; the input value is
        persisted as-is
      - `{ value }` → schema or transform produced an output value;
        persist that value on `write` / `update` / `patch` after a
        read-stability re-check
      - Throw → validation failure
- [ ] In `packages/store/src/field.ts`, update `makeValidator<S>(schema)` to
      return `Promise<{ value: unknown }>` on success (after schema
      validation succeeds, return `{ value: result.value }`). On issues,
      keep throwing as today.
- [ ] Run targeted tests:
      `bun run --cwd packages/store check:types`
      (store tests should compile; runtime tests still fail until Step 3)
- [ ] Commit at step boundary: `refactor(TP-018): widen FieldDef.validate
      contract for transform persistence`

**Artifacts:**
- `packages/store/src/types.ts` (modified — widened validate signature)
- `packages/store/src/field.ts` (modified — makeValidator returns `{ value }`)

### Step 3: Persist transforms with read-stability guard in `runFieldValidators`

- [ ] In `packages/store/src/store.ts`, replace the migration-guard
      `TypeError` block (~lines 144-149) with the persistence flow described
      in **File Scope**:
  - `result === undefined` → continue (validation-only succeeded)
  - `result` is `{ value }` shape → capture `transformed`; on
    non-`read` ops AND `!Object.is(transformed, value)`, run the read-
    stability re-check; on success, `record[key] = transformed`; on
    re-check failure, push a `read-unstable transform` issue and skip
    persistence for that field
  - Any other shape → throw `TypeError` (caller bug, e.g. legacy
    `{ ok, value }` return)
- [ ] Verify Step 1 RED tests now pass; verify GREEN/pin tests still pass
- [ ] Run targeted tests:
      `bun run --cwd packages/store test`
- [ ] Commit at step boundary: `feat(TP-018): persist schema transforms
      with read-stability guard`

**Artifacts:**
- `packages/store/src/store.ts` (modified — `runFieldValidators` body)

### Step 4: Documentation flip

> Same commit as the changeset so docs and behavior stay in sync.

- [ ] Replace `apps/docs/content/docs/modules/store.mdx` lines ~345-346
      ("Store field validators are validation-only. Schema transforms/
      coercions … are not written back into store state.") with:
      ```
      Schema transforms in fields passed to `field()` are applied on
      `write`, `update`, and `patch` — never on `read`. The transformed
      output is re-validated before persisting; a transform that produces
      a value the schema would itself reject (e.g.
      `z.string().transform(Number)` — string in, number out) is rejected
      at write time with a `CrustStoreError("VALIDATION")` tagged
      `read-unstable transform`. Existing on-disk values survive
      unchanged on `read`; canonicalization happens on the next `write`.
      ```
- [ ] Update `packages/store/README.md` — find the analogous validation
      section (~lines 316-347; search for "validation-only" or "not
      written back") and apply the same inversion
- [ ] No changes to `apps/docs/content/docs/modules/validate.mdx` (PR #123
      already cleaned the validate-side redirect)

**Artifacts:**
- `apps/docs/content/docs/modules/store.mdx` (modified)
- `packages/store/README.md` (modified)

### Step 5: Changeset

- [ ] Run `bunx changeset` and produce a single `@crustjs/store` minor
      changeset describing:
  - new transform-persistence behavior on `write` / `update` / `patch`
  - new write-time read-stability guard with `read-unstable transform`
    error message
  - widened `FieldDef.validate` return contract (`void | { value }`)
  - behavior-change note for users with `.transform(...)` schemas:
    existing on-disk values survive unchanged on read; the first
    subsequent write canonicalizes through the transform
  - explicit "no surface contraction" note: no public types removed; no
    new exports
- [ ] Commit the changeset markdown alongside the code

**Artifacts:**
- `.changeset/<timestamped>.md` (new)

### Step 6: Testing & Verification

> ZERO test failures allowed. This step runs the FULL suite as a quality
> gate.

- [ ] FULL test suite passing: `bun run test`
- [ ] Lint clean: `bun run check`
- [ ] Types clean: `bun run check:types`
- [ ] Build clean: `bun run build`
- [ ] Manual sanity scenarios:
  - [ ] In a scratch script: a store with one literal field
        (`{ type: "string", default: "x" }`) reads / writes / updates
        identically to before
  - [ ] In a scratch script: a store with one Zod field
        (`field(z.string().transform(s => s.trim()))`) writes a trimmed
        value to disk; subsequent read returns the trimmed value
  - [ ] In a scratch script: a Zod transform that maps `string` →
        `number` (`field(z.string().transform(Number))`) is rejected at
        `write()` with a `read-unstable transform` error; no on-disk
        write occurs
  - [ ] In a scratch script: a hand-rolled
        `validate: (v) => { if (...) throw }` callback returning `void`
        accepts / rejects identically to before
- [ ] Fix all failures before proceeding

### Step 7: Documentation & Delivery

- [ ] "Must Update" docs modified
- [ ] "Check If Affected" docs reviewed
- [ ] Discoveries logged in STATUS.md
- [ ] Final commit at step boundary

## Documentation Requirements

**Must Update:**

- `apps/docs/content/docs/modules/store.mdx` — invert the
  "validation-only" / "not written back" paragraph at lines ~345-346;
  add the `read-unstable transform` error description
- `packages/store/README.md` — mirror the mdx change

**Check If Affected:**

- `apps/docs/content/docs/guide/*.mdx` — search for "transform" and
  "store transform" / "not written back"; redirect any cross-links
- `taskplane-tasks/CONTEXT.md` — if a tech-debt entry references
  "store transforms not persisted" or "store/command asymmetry", clear it

## Completion Criteria

- [ ] Schema-driven transforms persist on `write` / `update` / `patch`;
      verified by RED → GREEN tests in Step 1
- [ ] Read-stability guard rejects cross-type transforms at write time;
      verified by RED → GREEN tests in Step 1
- [ ] Plain-literal end-to-end behavior unchanged; verified by GREEN/pin
      test in Step 1
- [ ] Hand-rolled `validate: (v) => { ... }` callbacks returning `void`
      unchanged; verified by GREEN/pin test in Step 1
- [ ] FULL test suite + check + check:types + build pass at repo root
- [ ] Single `@crustjs/store` changeset committed
- [ ] Docs updated; "validation-only" / "not written back" paragraph gone
      from `store.mdx` and `packages/store/README.md`

## Git Commit Convention

Commits happen at **step boundaries** (not after every checkbox). All
commits for this task MUST include the task ID for traceability:

- **Step completion:** `feat(TP-018): complete Step N — description`
- **Bug fixes:** `fix(TP-018): description`
- **Tests:** `test(TP-018): description`
- **Refactor:** `refactor(TP-018): description`
- **Docs:** `docs(TP-018): description`
- **Hydration:** `hydrate: TP-018 expand Step N checkboxes`

## Do NOT

- **Do NOT** add a polymorphic `FieldSpec` union or accept raw schemas in
  `createStore({ fields })`. Users keep wrapping with `field()`. This is
  explicitly out of scope for the lean version (operator decision
  2026-05-12).
- **Do NOT** add a `store.fields()` introspection API or a
  `StoreFieldMetadata` type. Out of scope; defer until a real consumer
  exists.
- **Do NOT** delete `normalizeStateTypes` or `coerceByType`. They stay;
  plain-literal coercion behavior is unchanged.
- **Do NOT** touch `@crustjs/validate`. PR #123 already locked its
  surface; no further changes here.
- **Do NOT** add `@standard-schema/spec` as a direct dependency of
  `@crustjs/store`. Transitive via `@crustjs/schema-utils` is sufficient
  for the reduced scope.
- **Do NOT** apply transforms on `read()`. Reads return what's on disk
  verbatim. Transforms run only on `write` / `update` / `patch`.
- Hand-edit `CHANGELOG.md`. Use `bunx changeset`.
- Commit without the `TP-018` prefix in the commit message.

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution.
     Format:
     ### Amendment N — YYYY-MM-DD HH:MM
     **Issue:** [what was wrong]
     **Resolution:** [what was changed] -->

### Amendment 1 — 2026-05-12 (post-PR #123, supervisor pre-flight)

**Issue:** PR #123 (TP-017, merged 2026-05-12, commit `3421dbf`) carried
part of TP-018's original deliverables in-flight — the `field()` helper
migration is done.

**What PR #123 delivered (do NOT redo):**

- `field()` lives in `@crustjs/store` (`packages/store/src/field.ts`) with
  three type-narrowing overloads.
- `field()` is removed from `@crustjs/validate`'s public surface; validate
  now exports exactly 7 functions.
- `packages/store/src/field.test.ts` (30 tests) proves field()'s shape +
  validation behavior.
- Changeset `field-to-store.md` records the validate major bump + store
  minor bump.
- `@crustjs/store` depends on `@crustjs/schema-utils` (workspace:*).

**Resolution:** Treat current `main` as the baseline. The original Step 6
(field() migration) is dropped from this PROMPT.

### Amendment 2 — 2026-05-12 (operator scope reduction)

**Issue:** The original PROMPT bundled three independent value streams
(transform persistence, polymorphic `FieldSpec`, `store.fields()`
introspection). After review, the operator determined that only the
transform-persistence stream had clear, immediate value:

- Polymorphic `FieldSpec` saves users one `field()` call per non-default
  field, but `field()` is still required for type-narrowing on
  default-bearing fields (Standard Schema v1 limitation). Net DX win is
  small; complexity cost (new union types, `literalToSchema()` adapter,
  `InferStoreConfig` branching, deletion of `normalizeStateTypes` /
  `coerceByType`) is real.
- `store.fields()` introspection has no consumer in the repo. Deferred
  until a real use case appears (e.g. a future `configPlugin` that
  auto-generates flags from a store).

**Resolution:** Rewrote the PROMPT to cover only the transform-persistence
stream. Steps 2 / 3 / 5 / 6 / 8 from the original PROMPT are dropped;
remaining steps renumbered. Task size reduced from L to M. Review level
reduced from 3 (Full) to 2 (Plan + Code). Single-package change
(`@crustjs/store` only — `@crustjs/validate` untouched).

The deferred work can be reopened in a follow-up task if/when a real
consumer for `store.fields()` materializes. The polymorphic `FieldSpec`
should only be revisited if user feedback explicitly asks for it.
