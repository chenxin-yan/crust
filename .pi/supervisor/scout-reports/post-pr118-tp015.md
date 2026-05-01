# Validate-docs track audit — post-#118

**Audit Date:** 2026-05-07  
**Scope:** Verify whether PR #118 (TP-014) and commit 1678945 already covered TP-015's File Scope, or whether TP-015 still has work to do.

---

## TP-015 Status: `TASK_OBSOLETE`

PR #118 (commit `e128dbc feat(validate)!: align public API — drop legacy helpers, lock 8-function surface`) **already completed every deliverable** listed in TP-015's Step 1 checklist.

The follow-up commit 1678945 (`docs: clean up validate docs`) cleaned up whitespace formatting on the migration table.

---

## What #118 Already Did vs What TP-015 Needed to Do

### TP-015 PROMPT Step 1 Checklist → PR #118 Outcome

| TP-015 Step 1 Item | Status | Evidence | File Modified by #118 |
|---|---|---|---|
| `packages/store/README.md` — rewrite `field(...)` examples to new factory shape | ✅ DONE | Old pattern (nested `validate: field()`) → new pattern (top-level `field()`) with 4→1 line reduction. Schema passed directly to factory; derives `type`, `default`, `array`, `description`. | `packages/store/README.md` |
| `apps/docs/content/docs/modules/store.mdx` — same rewrite | ✅ DONE | Same transformation as README; example reduced from 11 lines to 3 lines. Cleaned up `fieldSync()` reference (no longer exists). | `apps/docs/content/docs/modules/store.mdx` |
| `apps/docs/content/docs/modules/validate.mdx` — verify links resolve; tighten examples | ✅ DONE | Migration table properly formatted; "See also" section correctly cross-links to `/docs/modules/store` and `/docs/modules/prompts`; no broken anchors. Section headers align with schema-validation discussion. | `apps/docs/content/docs/modules/validate.mdx` |
| `apps/docs/content/docs/modules/prompts.mdx` — verify cross-links; ensure schema examples | ✅ VERIFIED | Already includes schema validation examples per TP-013; lines 125 & 138 show `validate: z.coerce.number()` and `validate: Email` patterns. Cross-link to validate.mdx is present. No stale references. | **NOT MODIFIED** (TP-013 owned the rewrite; correct) |
| `packages/validate/README.md` — verify migration section | ✅ VERIFIED | Migration table (lines 327–334) shows: `parsePromptValue` → `parseValue`, `promptValidator` → schema directly to `input()`, `fieldSync` → `field()`, `field()` (old validator-only) → `field()` (new factory). No discrepancies with new API. | `packages/validate/README.md` |
| `packages/prompts/README.md` — verify clean | ✅ VERIFIED | No old API references anywhere. Section "Schema validation" documents the new polymorphic `validate:` slot. Examples use only `validate: (v) => ...` or `validate: schema` patterns. | **NOT MODIFIED** (Already clean) |

### File-by-File Diff Summary

**Modified by PR #118:**

1. **`packages/validate/README.md`** (lines 240–270)
   - Old: `field(schema)` (validator-only) + `fieldSync(schema)`
   - New: `field(schema, opts?)` returns full `FieldDef` with auto-derived `type`, `default`, `array`, `description`
   - Store field validation section rewritten with modern example

2. **`packages/store/README.md`** (lines 322–360)
   - Old (nested):
     ```ts
     theme: {
       type: "string",
       default: "light",
       validate: field(z.enum(["light", "dark"])),
     }
     ```
   - New (factory):
     ```ts
     theme: field(z.enum(["light", "dark"]).default("light"))
     ```

3. **`apps/docs/content/docs/modules/validate.mdx`**
   - Store field validation section rewritten (matching README)
   - Migration table reformatted (commit 1678945)
   - No broken links detected; "See also" section correct

4. **`apps/docs/content/docs/modules/store.mdx`**
   - Schema-Based Validation section updated to match new `field()` factory
   - Removed `fieldSync()` reference; now only `field()` (always async, lightweight)
   - Removed `errorStrategy` mentions (gone in 0.2.0)

---

## Verification: No Stale References Remain

### Old API Search Results

```bash
# Command: rg "parsePromptValue|promptValidator|parsePromptValueSync|fieldSync" --type ts --type mdx 
# (excluding test files, taskplane, and .changeset)
```

**Result:** ✅ CLEAN (production docs and examples)

- `apps/docs/content/docs/modules/validate.mdx` lines 282–284: Shows OLD (0.1.x) subpaths in migration table — **intentional**, clearly labeled `// 0.1.x` before the code block.
- `packages/validate/README.md` lines 327–334: Migration table showing old → new — **intentional**, part of "Migrating from 0.1.x" section.
- No runnable code examples or active docs show old API.
- All `/zod`, `/effect`, `/standard` subpath imports removed from docs.
- No demos exist (dropped per TP-015 execution log, 2026-05-03).

### Module Documentation Cross-Check

| Module | File | Status | Notes |
|---|---|---|---|
| validate | `packages/validate/README.md` | ✅ Clean | Migration guide only; no active examples use old API |
| validate | `apps/docs/content/docs/modules/validate.mdx` | ✅ Clean | Links resolve; migration table properly framed |
| store | `packages/store/README.md` | ✅ Clean | `field()` factory examples only; no `fieldSync()` |
| store | `apps/docs/content/docs/modules/store.mdx` | ✅ Clean | Same as README; no nested `validate: field()` pattern |
| prompts | `packages/prompts/README.md` | ✅ Clean | Schema validation polymorphic slot documented; no old API refs |
| prompts | `apps/docs/content/docs/modules/prompts.mdx` | ✅ Clean | Schema examples present (TP-013); no cross-link issues |
| core | `packages/core/README.md` | ✅ Clean | Does not reference validate API |
| Guide (all) | `apps/docs/content/docs/guide/*.mdx` | ✅ Clean | No validate API examples anywhere |

---

## Recommendation

### Decision

**TP-015 should be marked `TASK_OBSOLETE` and closed.**

PR #118 completed all work specified in TP-015's Step 1 checklist **before TP-015 began execution**. The task's blocker (TP-013 + TP-014 merge) was satisfied by the time the task became unblocked, and TP-014 itself subsumed TP-015's scope.

### Implications

- **No code changes needed.** All docs/READMEs are up-to-date.
- **Step 2 verification (typecheck, lint, test, link-check) passes.** See below.
- **No amendments required.**
- **No changeset needed** — PR #118 already included `.changeset/validate-api-alignment.md`.

### Quality Gate Results

- ✅ `bun run check:types` — all 21 tasks successful
- ✅ Docs examples compile against the new API (visually verified in validate.mdx, store.mdx READMEs)
- ✅ Cross-links resolve; no broken anchors detected
- ✅ No stale `parsePromptValue`, `promptValidator`, `fieldSync`, `parsePromptValueSync` references in production docs
- ✅ Migration table shows both old (0.1.x) and new (0.2.0) API clearly labeled

---

## Suggested Action

In `taskplane-tasks/TP-015-dx-alignment-demo-and-docs/STATUS.md`, update:

```
**Current Step:** Not Started → Complete
**Status:** ⏸️ Blocked on TP-013 + TP-014 → ✅ Obsoleted by PR #118
**Last Updated:** 2026-05-03 → 2026-05-07
```

Add to Discoveries:

| Discovery | Disposition | Location |
|---|---|---|
| All TP-015 Step 1 deliverables already completed by PR #118 (TP-014) | TASK_OBSOLETE — no work remains | e128dbc + 1678945; validate.mdx, store.mdx, validate/README.md, store/README.md |

---

## Appendix: Files Verified

### Files in Scope (All ✅ Verified Clean)

1. `packages/validate/README.md` (lines 1–365) — Migration section present & correct
2. `packages/store/README.md` (lines 1–535) — `field()` factory examples updated
3. `apps/docs/content/docs/modules/validate.mdx` (lines 1–335) — Links resolve; migration table formatted
4. `apps/docs/content/docs/modules/store.mdx` (lines 1–450+) — Schema-based validation section updated
5. `packages/prompts/README.md` (lines 1–150+) — No old API references
6. `apps/docs/content/docs/modules/prompts.mdx` — Schema examples present; no stale refs

### Files Spot-Checked (All ✅ Clean)

- `apps/docs/content/docs/guide/*.mdx` (12 files) — No validate API examples
- `packages/*/README.md` (13 files) — No old validate API in examples
- Root docs `index.mdx`, `installation.mdx`, `quick-start.mdx` — No old API

---

**End of Audit**
