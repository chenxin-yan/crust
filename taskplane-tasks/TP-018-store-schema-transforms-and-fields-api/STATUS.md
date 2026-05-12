# TP-018: Store schema transform persistence + read-stability guard — Status

**Current Step:** Step 7: Documentation & Delivery
**Status:** ✅ Complete
**Last Updated:** 2026-05-12 (iteration 1)

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
**Status:** ✅ Complete

- [x] Migration-guard `TypeError` block replaced with persistence flow
- [x] `result === undefined` → continue (validation-only path preserved)
- [x] `result.value` captured; non-`read` ops persist when changed
- [x] Read-stability re-check rejects cross-type transforms
- [x] Step 1 RED tests now pass
- [x] Step 1 GREEN/pin tests still pass
- [x] Updated pre-existing `field.test.ts` adapter test to assert `{ value }` shape (contract widening; see Discoveries)

---

### Step 4: Documentation flip
**Status:** ✅ Complete

- [x] `store.mdx` lines ~345-346 inverted; new contract documented (transform persistence + read-stability guard + read-verbatim guarantee)
- [x] `packages/store/README.md` validation section mirrored (per-operation behavior table updated)

---

### Step 5: Changeset
**Status:** ✅ Complete

- [x] `bunx changeset` produces single `@crustjs/store` minor entry (`.changeset/store-transform-persistence.md`)
- [x] Behavior-change note explicit (trim example; existing on-disk values survive on read; canonicalize on next write)
- [x] `FieldDef.validate` widened contract documented
- [x] No surface contraction note included

---

### Step 6: Testing & Verification
**Status:** ✅ Complete

- [x] FULL test suite passing (`bun run test`) — all 23 tasks pass
- [x] Lint clean (`bun run check`)
- [x] Types clean (`bun run check:types`)
- [x] Build clean (`bun run build`)
- [x] Manual sanity: literal store unchanged (write/read/update/reset round-trip)
- [x] Manual sanity: Zod trim store persists trimmed (`  hi   ` → `hi` on disk)
- [x] Manual sanity: `string → number` transform rejected at write (read-unstable, no file written)
- [x] Manual sanity: hand-rolled `validate` void-return unchanged (8080 accepted, 0 rejected)
- [x] Manual sanity (bonus): pre-seeded file survives `read()` unchanged; next `write` canonicalizes

---

### Step 7: Documentation & Delivery
**Status:** ✅ Complete

- [x] "Must Update" docs modified (`store.mdx`, `packages/store/README.md`)
- [x] "Check If Affected" docs reviewed (`apps/docs/content/docs/guide/*.mdx` — only `lifecycle.mdx` mentions "transform" in an unrelated context; `taskplane-tasks/CONTEXT.md` has no entries for store/command asymmetry)
- [x] Discoveries logged (see Discoveries section)

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|
| `field.test.ts` adapter test asserted `def.validate("hello")` resolves `undefined` | Updated to assert `{ value: "hello" }` and added a sibling test for transformed output | `packages/store/src/field.test.ts:110` |
| Step 1 "Read does NOT transform" test passes today (PROMPT labeled RED) | Retained as pin/contract assertion; the underlying property is preserved by the new `operation === "read"` skip in `runFieldValidators` | `packages/store/src/store.test.ts` |

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-05-07 | Task staged | PROMPT.md and STATUS.md created |
| 2026-05-12 | Amendment 1 | PR #123 pre-delivered Step 6 (field() migration); workers skip |
| 2026-05-12 | Amendment 2 | Scope reduced from L to M; dropped polymorphic `FieldSpec` + `store.fields()` API per operator decision |
| 2026-05-12 23:48 | Task started | Runtime V2 lane-runner execution |
| 2026-05-12 23:48 | Step 0 started | Preflight |
| 2026-05-12 | Steps 0–7 complete | All RED tests turn GREEN; full suite + check + check:types + build pass; 5/5 manual sanity scenarios pass; single `@crustjs/store` minor changeset committed |

---

## Blockers

- None. PR #123 (TP-017 + field() migration) is merged on `main`.

---

## Notes

*Reserved for execution notes*
