# Task: TP-011 — Consolidate type primitives into `@crustjs/utils`

**Created:** 2026-04-29
**Size:** M

## Review Level: 1 (Plan Only)

**Assessment:** Pure refactor moving duplicated `ValueType`, `ResolvePrimitive`,
and two trivial coercion helpers from `@crustjs/core` and `@crustjs/store` into
`@crustjs/utils` as the single source of truth. Behavior preservation is the
only sharp edge: core throws on `Number("abc")`, store silently returns the
original string on the same input — these MUST diverge after the refactor too.
A plan review locks the wrapper-pattern around the new neutral `tryCoerceNumber`
helper before any code lands.
**Score:** 3/8 — Blast radius: 1 (touches core+store+utils, but pure refactor — `ValueType` re-exported transparently), Pattern novelty: 0 (just moving code), Security: 0, Reversibility: 1 (re-exports preserve back-compat at 0.x)

## Canonical Task Folder

```
taskplane-tasks/TP-011-consolidate-type-primitives-to-utils/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (created by the orchestrator runtime)
└── .DONE       ← Created when complete
```

## Mission

Move the duplicated primitive type system (`ValueType` literal union and
`ResolvePrimitive<T>` mapper) from `@crustjs/core` and `@crustjs/store` into
`@crustjs/utils` as the single source of truth, and add two pure coercion
helpers (`tryCoerceNumber`, `coerceBooleanString`) that both packages already
have nearly-identical copies of. This is a pure refactor — zero behavior
change. Core's `coerceValue` continues to throw `CrustError("PARSE", ...)` on
`Number("abc")` (CLI argv must be valid); store's `coerceByType` continues to
silently return the original string on the same input (defensive against
hand-edited JSON). Both wrap the new neutral `tryCoerceNumber(raw): number |
undefined` helper differently — core does `tryCoerceNumber(v) ?? throw …`,
store does `tryCoerceNumber(v) ?? v` — to preserve their intentional
divergence. Existing core and store tests must pass without modification; if
a test fails, the refactor is wrong, not the test.

## Dependencies

- **Task:** TP-005 (utils package must exist before we can extend it)

## Context to Read First

> Only list docs the worker actually needs. Less is better.

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `packages/core/src/types.ts` — file being modified; contains the local `ValueType` (line ~6) and internal `ResolvePrimitive<T>` (lines ~15–21) to be replaced
- `packages/core/src/parser.ts` — file being modified; especially `coerceValue` (~lines 129–175) which currently does `Number(value)` + NaN-throw and `value === "true" || value === "1"` inline
- `packages/store/src/types.ts` — file being modified; contains the local `ValueType` (line ~10) and internal `ResolvePrimitive<T>` (lines ~19–25) to be replaced
- `packages/store/src/store.ts` — file being modified; especially `coerceByType` (~lines 64–90) which currently does `Number(value)` + silent-fallback-to-string and `value === "true" || value === "1"` inline
- `packages/utils/src/index.ts` — the package barrel created by TP-005; needs a re-export for the new `./primitive.ts` module
- `packages/utils/src/source.ts` — pattern reference for what utils exports look like (created by TP-005)
- `packages/utils/README.md` — needs a new "Type primitives" section
- `packages/core/src/parser.test.ts` — DO NOT MODIFY; existing assertions verify the throw-on-NaN behavior of `coerceValue`
- `packages/store/src/store.test.ts` — DO NOT MODIFY; existing assertions verify the silent-string-fallback behavior of `coerceByType`

## Environment

- **Workspace:** `packages/utils/` (primary), `packages/core/`, `packages/store/`
- **Services required:** None

## File Scope

**New files:**
- `packages/utils/src/primitive.ts`
- `packages/utils/src/primitive.test.ts`

**Modified files:**
- `packages/utils/src/index.ts` — re-export everything from `./primitive.ts`
- `packages/utils/README.md` — add a "Type primitives" section listing the four new exports
- `packages/core/src/types.ts` — replace local `ValueType` and internal `ResolvePrimitive` with imports from `@crustjs/utils`; export `ValueType` as an alias for `BaseValueType` so downstream consumers of `import type { ValueType } from "@crustjs/core"` keep working unchanged
- `packages/core/src/parser.ts` — `coerceValue()` uses `tryCoerceNumber` (still throws `CrustError("PARSE", ...)` when the helper returns `undefined`) and `coerceBooleanString`
- `packages/core/package.json` — add `"@crustjs/utils": "workspace:*"` to `dependencies`
- `packages/store/src/types.ts` — replace local `ValueType` and internal `ResolvePrimitive` with imports from `@crustjs/utils`; export `ValueType` as an alias for `BaseValueType`
- `packages/store/src/store.ts` — `coerceByType()` uses `tryCoerceNumber` preserving silent-return-string semantics (`tryCoerceNumber(v) ?? v`) and `coerceBooleanString`
- `packages/store/package.json` — add `"@crustjs/utils": "workspace:*"` to `dependencies`

**Changesets (new):**
- `.changeset/*-utils-primitive-base.md` — `@crustjs/utils`: minor (new public exports `BaseValueType`, `ResolvePrimitive`, `tryCoerceNumber`, `coerceBooleanString`)
- `.changeset/*-core-utils-primitive.md` — `@crustjs/core`: patch (internal refactor; `ValueType` re-exported from utils transparently)
- `.changeset/*-store-utils-primitive.md` — `@crustjs/store`: patch (internal refactor; `ValueType` re-exported from utils transparently)

## Steps

> **Hydration:** STATUS.md tracks outcomes, not individual code changes. Workers
> expand steps when runtime discoveries warrant it. See task-worker agent for rules.

### Step 0: Preflight

- [ ] Verify TP-005 is complete and `packages/utils/` exists with a working `src/index.ts`
- [ ] `bun install` succeeds at the repo root
- [ ] All existing core + store tests pass on the current branch before any changes:
      `cd packages/core && bun test && cd ../store && bun test`

### Step 1: Create the shared primitives module in `@crustjs/utils`

- [ ] Create `packages/utils/src/primitive.ts` exporting:
  - `export type BaseValueType = "string" | "number" | "boolean";`
  - `export type ResolvePrimitive<T extends BaseValueType>` — distributive conditional mapping `"string" → string`, `"number" → number`, `"boolean" → boolean`
  - `export function tryCoerceNumber(raw: string): number | undefined` — returns `Number(raw)` when not NaN, else `undefined`. Callers own the throw-vs-silent-fallback policy.
  - `export function coerceBooleanString(raw: string): boolean` — returns `raw === "true" || raw === "1"`. Preserves existing core+store semantics verbatim.
- [ ] Create `packages/utils/src/primitive.test.ts` with at least 6 assertions covering happy paths and NaN behavior, plus one type-level test verifying distributivity (e.g., a `type _ = Expect<Equal<ResolvePrimitive<"number" | "boolean">, number | boolean>>`):
  - `tryCoerceNumber("42") === 42`
  - `tryCoerceNumber("abc") === undefined`
  - `tryCoerceNumber("") === undefined`
  - `coerceBooleanString("true") === true`
  - `coerceBooleanString("1") === true`
  - `coerceBooleanString("false") === false`
  - Type-level: `ResolvePrimitive<"string">` is `string`; `ResolvePrimitive<"number" | "boolean">` distributes to `number | boolean`
- [ ] Update `packages/utils/src/index.ts` to re-export everything from `./primitive.ts`
- [ ] Update `packages/utils/README.md` with a brief "Type primitives" section listing the four new exports and a one-line note that callers wrap `tryCoerceNumber` according to their own failure policy
- [ ] Run targeted tests on `@crustjs/utils`: `cd packages/utils && bun test`

**Artifacts:**
- `packages/utils/src/primitive.ts` (new)
- `packages/utils/src/primitive.test.ts` (new)
- `packages/utils/src/index.ts` (modified)
- `packages/utils/README.md` (modified)

### Step 2: Migrate `@crustjs/core` to use the shared primitives

- [ ] In `packages/core/src/types.ts`: replace the local `export type ValueType = "string" | "number" | "boolean"` with an import + alias re-export so back-compat holds:
      `import type { BaseValueType, ResolvePrimitive } from "@crustjs/utils";`
      `export type ValueType = BaseValueType;`
- [ ] Replace the local `ResolvePrimitive<T>` definition with the import; remove the dead local declaration
- [ ] In `packages/core/src/parser.ts` `coerceValue()`:
  - Number branch uses `tryCoerceNumber(value)` and throws `CrustError("PARSE", 'Expected number for ${label}, got "${value}"')` when the helper returns `undefined` — preserves the existing error message and code verbatim
  - Boolean branch uses `coerceBooleanString(value)`
- [ ] Add `"@crustjs/utils": "workspace:*"` to `packages/core/package.json` `dependencies`
- [ ] Run targeted tests on `@crustjs/core` — every existing test in `parser.test.ts`, `types.test.ts`, and the integration/smoke suites must still pass with NO modification:
      `cd packages/core && bun test`

**Artifacts:**
- `packages/core/src/types.ts` (modified)
- `packages/core/src/parser.ts` (modified)
- `packages/core/package.json` (modified)

### Step 3: Migrate `@crustjs/store` to use the shared primitives

- [ ] In `packages/store/src/types.ts`: same pattern as core — replace local `ValueType` with `import type { BaseValueType, ResolvePrimitive } from "@crustjs/utils"` and `export type ValueType = BaseValueType`. Remove the dead local `ResolvePrimitive<T>` declaration.
- [ ] In `packages/store/src/store.ts` `coerceByType()`:
  - Number branch: `const n = tryCoerceNumber(v); return n ?? v;` — preserves silent-return-original-string-on-NaN exactly. This wrapping is the critical preservation point.
  - Boolean branch: `coerceBooleanString(v)`
- [ ] Add `"@crustjs/utils": "workspace:*"` to `packages/store/package.json` `dependencies`
- [ ] Run targeted tests on `@crustjs/store` — every existing test in `store.test.ts`, `merge.test.ts`, and `types.test.ts` must still pass with NO modification:
      `cd packages/store && bun test`

**Artifacts:**
- `packages/store/src/types.ts` (modified)
- `packages/store/src/store.ts` (modified)
- `packages/store/package.json` (modified)

### Step 4: Testing & Verification

> ZERO test failures allowed. This step runs the FULL test suite as a quality gate.
> (Earlier steps used targeted package tests for fast feedback.)

- [ ] Run FULL test suite: `bun run check && bun run check:types && bun run test`
- [ ] Run build: `bun run build`
- [ ] Fix any failures (if a core or store test fails, the refactor is wrong — do NOT edit the test)
- [ ] Add 3 changesets via `bunx changeset`:
  - `@crustjs/utils`: minor — "Add `BaseValueType`, `ResolvePrimitive`, `tryCoerceNumber`, `coerceBooleanString` as the shared primitive type vocabulary for `@crustjs/core` and `@crustjs/store`."
  - `@crustjs/core`: patch — "Internal refactor: `ValueType` and `ResolvePrimitive` now sourced from `@crustjs/utils`. `ValueType` is re-exported transparently — no consumer-visible change. `coerceValue` rewraps the new shared `tryCoerceNumber` helper and continues to throw `CrustError(\"PARSE\")` on NaN."
  - `@crustjs/store`: patch — "Internal refactor: `ValueType` and `ResolvePrimitive` now sourced from `@crustjs/utils`. `ValueType` is re-exported transparently — no consumer-visible change. `coerceByType` rewraps the new shared `tryCoerceNumber` helper and continues to silently return the original string on NaN."

### Step 5: Documentation & Delivery

> ⚠️ Hydrate: At entry, check whether `apps/docs/content/docs/modules/utils.mdx` exists from TP-005. If it does, append a section for the new primitives module mirroring the README change. If it doesn't, skip the docs-site change (TP-005 didn't author one) and note this in STATUS.md Discoveries.

- [ ] "Must Update" docs modified: `packages/utils/README.md` describes the four new exports
- [ ] "Check If Affected" docs reviewed:
  - `apps/docs/content/docs/modules/utils.mdx` — appended if it exists
  - `apps/docs/content/docs/api/*.mdx` — verify no doc references `ValueType` from core in a way that the transparent re-export would break (it shouldn't; the re-export is identity)
- [ ] Discoveries logged in STATUS.md (e.g., whether `utils.mdx` existed; any unexpected re-export consumers found in grep)

## Documentation Requirements

**Must Update:**
- `packages/utils/README.md` — add a "Type primitives" section listing `BaseValueType`, `ResolvePrimitive`, `tryCoerceNumber`, `coerceBooleanString` with one-line descriptions and the wrapper-pattern note (callers own throw-vs-silent failure policy)

**Check If Affected:**
- `apps/docs/content/docs/modules/utils.mdx` — if TP-005 created it, append a section for the new primitives module
- `apps/docs/content/docs/api/*.mdx` — if any API doc references `ValueType` from core, no change needed (re-export is transparent)

## Completion Criteria

- [ ] All steps complete
- [ ] All tests passing (full suite green; no core or store tests modified)
- [ ] Build green
- [ ] 3 changesets staged
- [ ] `packages/utils/README.md` updated

## Git Commit Convention

Commits happen at **step boundaries** (not after every checkbox). All commits
for this task MUST include the task ID for traceability:

- **Step completion:** `feat(TP-011): complete Step N — description`
- **Bug fixes:** `fix(TP-011): description`
- **Tests:** `test(TP-011): description`
- **Hydration:** `hydrate: TP-011 expand Step N checkboxes`

## Do NOT

- Do NOT change the throw-vs-silent-return divergence between core's `coerceValue` and store's `coerceByType`. Preserve verbatim behavior — core throws `CrustError("PARSE", ...)` on `Number("abc")`; store silently returns the original string. Both wrap the new neutral `tryCoerceNumber` helper differently to keep this divergence intact.
- Do NOT modify any tests in `packages/core/src/parser.test.ts` or `packages/store/src/store.test.ts` — they must pass unchanged. If a test fails, the refactor is wrong, not the test.
- Do NOT plumb consolidation through `@crustjs/validate` — its 3 internal `ValueType` copies are deferred per the type-system expansion review (logged in CONTEXT.md tech debt). TP-007 will reduce these from 3 → 1; a future cleanup task can plumb through utils.
- Do NOT add new features beyond moving existing logic. No new types, no new helpers besides the listed two (`tryCoerceNumber`, `coerceBooleanString`).
- Do NOT modify `packages/utils/package.json` `version` directly — let changeset tooling bump it.
- Do NOT touch `packages/validate/`, the zod adapters, or the effect adapters. Out of scope.
- Expand task scope — add tech debt to CONTEXT.md instead
- Skip tests
- Modify framework/standards docs without explicit user approval
- Load docs not listed in "Context to Read First"
- Commit without the task ID prefix in the commit message

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution.
     Format:
     ### Amendment N — YYYY-MM-DD HH:MM
     **Issue:** [what was wrong]
     **Resolution:** [what was changed] -->

### Amendment 1 — 2026-05-07 (post-PR #118, supervisor pre-flight)

**Issue:** PR #118 (TP-014, merged 2026-05-07) added a third private copy of
`ValueType` in `packages/validate/src/schema-types.ts:30` (`"string" | "number"
| "boolean"` — structurally identical to core's at `types.ts:6` and store's
at `types.ts:10`). The new copy is also referenced internally by
`InferredOptions` (`introspect/registry.ts`), `ZodInferResult`
(`introspect/zod.ts`), and `EffectInferResult` (`introspect/effect.ts`).

**Resolution:** No scope change required. TP-011's existing "Do NOT touch
`packages/validate/`" guidance stands — validate consolidation remains
deferred per CONTEXT.md tech debt, and the PROMPT body already documents
that deferral explicitly. A future cleanup task (post-TP-011) can plumb
validate's `ValueType` through `@crustjs/utils` once the utils surface
stabilizes.

Workers should be aware of the third copy when reading `schema-types.ts`
for unrelated reasons during this task, but should not migrate it.

### Amendment 2 — 2026-05-12 (post-PR #123, supervisor pre-flight)

**Issue:** PR #123 (TP-017, merged 2026-05-12) deleted
`packages/validate/src/schema-types.ts` and relocated `field()` from
`packages/validate/src/store.ts` → `packages/store/src/field.ts`. The new
`field.ts` re-introduces a private `type ValueType = "string" | "number" |
"boolean"` at `packages/store/src/field.ts:81`, used by the schema-to-field
introspection machinery. This is a fourth copy that did not exist when the
PROMPT was authored.

**Resolution:** Scope expansion (one-line change). When migrating store's
`ValueType` (Step 3), also update `packages/store/src/field.ts:81`:

- Replace `type ValueType = "string" | "number" | "boolean";` with
  `import type { BaseValueType as ValueType } from "@crustjs/utils";`
  (or equivalent re-export).
- field.ts is already inside the store package that imports utils in Step 3,
  so no new dependency edge is added.
- No behavior change; no new tests needed; existing `field.test.ts` proves
  parity.

**Stale references in Amendment 1:** The third copy at
`packages/validate/src/schema-types.ts:30` no longer exists — PR #123 removed
that file entirely. Amendment 1's "Do NOT touch validate" guidance still
stands for validate's remaining `ValueType` usage (now inlined into
`packages/validate/src/types.ts` via the schema-utils import chain), but the
specific file/line citation is obsolete.
