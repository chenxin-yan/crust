# TP-018: Store schema transform persistence + read-stability guard — Status

**Current Step:** Step 3: Persist transforms with read-stability guard
**Status:** 🟡 In Progress
**Last Updated:** 2026-05-12

> **Scope reduction 2026-05-12 (operator decision):** original PROMPT
> bundled three streams (transform persistence, polymorphic `FieldSpec`,
> `store.fields()` introspection). Operator dropped streams B + C; only
> transform persistence + read-stability guard + doc flip remain. See
> PROMPT Amendment 2 for rationale. Single-package change inside
> `@crustjs/store` only.

**Review Level:** 2 (Plan + Code)
**Review Counter:** 0
**Iteration:** 1
**Size:** M

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it. Step 1's
> failing-tests-first chunk is intentionally outcome-level — write the
> specific test names + assertions during execution.

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] Required files and paths exist
- [x] PR #123 baseline confirmed (`field()` in store; `validate` exports 7 functions)
- [x] Pre-edit test suite green (store) — 251 tests pass after `bun run build:packages`

---

### Step 1: Failing-tests-first — pin the transform-persistence asymmetry
**Status:** ✅ Complete

> Three RED tests + two GREEN/pin tests. Watch RED fail, GREEN pass.

- [x] RED: Zod `.transform(s => s.trim())` persists on write (on-disk JSON) — added write/update/patch variants; all RED today
- [x] RED: read does NOT transform (pre-seeded file unchanged after read) — added; technically pin (passes today, retained as contract assertion for the new code path)
- [x] RED: read-stability guard rejects `string → number` transform at write — used `z.string().transform(s => s.length)` for clean cross-type signal; RED today
- [x] GREEN/pin: plain literal `{ type: "string", default: "x" }` end-to-end — passes
- [x] GREEN/pin: hand-rolled `validate: (v) => { ... }` void-return contract — passes

---

### Step 2: Widen `FieldDef.validate` contract; update `field()` helper
**Status:** ✅ Complete

- [x] `FieldDef.validate` return type widened to `void | { value: T }` (sync/async)
- [x] `field.ts` `makeValidator` returns `{ value: result.value }` on success
- [x] `bun run --cwd packages/store check:types` clean

---

### Step 3: Persist transforms with read-stability guard in `runFieldValidators`
**Status:** ⬜ Not Started

- [ ] Migration-guard `TypeError` block replaced with persistence flow
- [ ] `result === undefined` → continue (validation-only path preserved)
- [ ] `result.value` captured; non-`read` ops persist when changed
- [ ] Read-stability re-check rejects cross-type transforms
- [ ] Step 1 RED tests now pass
- [ ] Step 1 GREEN/pin tests still pass

---

### Step 4: Documentation flip
**Status:** ⬜ Not Started

- [ ] `store.mdx` lines ~345-346 inverted; new contract documented
- [ ] `packages/store/README.md` validation section mirrored

---

### Step 5: Changeset
**Status:** ⬜ Not Started

- [ ] `bunx changeset` produces single `@crustjs/store` minor entry
- [ ] Behavior-change note explicit (trim example; existing on-disk values survive on read; canonicalize on next write)
- [ ] `FieldDef.validate` widened contract documented
- [ ] No surface contraction note included

---

### Step 6: Testing & Verification
**Status:** ⬜ Not Started

- [ ] FULL test suite passing (`bun run test`)
- [ ] Lint clean (`bun run check`)
- [ ] Types clean (`bun run check:types`)
- [ ] Build clean (`bun run build`)
- [ ] Manual sanity: literal store unchanged
- [ ] Manual sanity: Zod trim store persists trimmed
- [ ] Manual sanity: `string → number` transform rejected at write
- [ ] Manual sanity: hand-rolled `validate` void-return unchanged

---

### Step 7: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] "Must Update" docs modified
- [ ] "Check If Affected" docs reviewed
- [ ] Discoveries logged

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-05-07 | Task staged | PROMPT.md and STATUS.md created |
| 2026-05-12 | Amendment 1 | PR #123 pre-delivered Step 6 (field() migration); workers skip |
| 2026-05-12 | Amendment 2 | Scope reduced from L to M; dropped polymorphic `FieldSpec` + `store.fields()` API per operator decision |
| 2026-05-12 23:48 | Task started | Runtime V2 lane-runner execution |
| 2026-05-12 23:48 | Step 0 started | Preflight |

---

## Blockers

- None. PR #123 (TP-017 + field() migration) is merged on `main`.

---

## Notes

*Reserved for execution notes*
