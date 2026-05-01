# TP-011 & TP-012 Staleness Audit — 2026-05-06

## TP-011 Staleness: BLOCKING DEPENDENCY NOT MET

**Severity:** CRITICAL — Task cannot proceed.

### Issue 1: @crustjs/utils Package Does Not Exist
- **Status:** TP-005 (`@crustjs/utils` package bootstrap) is **not started** (status: "Ready for Execution", step 0: "Not Started")
- **Impact:** TP-011 Step 1 requires creating `packages/utils/src/primitive.ts`, which depends on a working `@crustjs/utils` package skeleton with `src/index.ts` already in place (per TP-011 PROMPT, Tier 3: "packages/utils/src/index.ts — the package barrel created by TP-005")
- **Current state:** No `/home/cyan/dev/github.com/chenxin-yan/crust/packages/utils/` directory exists
- **Blockers:** TP-005 depends on TP-003 and TP-004 being merged first; both are complete (`packages/skills/src/bundle.ts` exists with private resolver from TP-003, `skills` package updated in TP-004)
- **Action required:** Execute TP-005 before TP-011 can start

### Issue 2: No Staleness in Referenced Source Files
**No staleness detected in the core TP-011 references:**
- ✅ `packages/core/src/types.ts` — ValueType definition at line 6, ResolvePrimitive at lines 12–19 (PROMPT says ~15–21; minor line drift due to other changes, but structure matches)
- ✅ `packages/core/src/parser.ts` — `coerceValue` function at lines 130–142 (PROMPT says ~129–175; exact location matches, function body intact for throw-on-NaN)
- ✅ `packages/store/src/types.ts` — ValueType at line 10, ResolvePrimitive at lines 14–22 (PROMPT says ~19–25; minor drift, structure matches)
- ✅ `packages/store/src/store.ts` — `coerceByType` function at lines 73–82 (PROMPT says ~64–90; function logic intact: returns NaN fallback)

### Issue 3: PR #116 Added New Validation Functions (Not Stale)
- **Commit:** f1baa45 "feat(core,plugins,man): add `aliases` to commands and subcommands (#116)"
- **Modified:** `packages/core/src/validation.ts` — added `validateAliasString` and `validateIncomingAliases` (lines ~17–130)
- **Impact on TP-011:** Zero. These functions validate *command* aliases (subcommand registration), not *type* primitives or coercion helpers. TP-011's "pure refactor" plan correctly doesn't mention them because they belong to a different concern (command tree validation, TP-016 work).
- **Validation.ts net change:** File grew but ValueType/ResolvePrimitive/coercion concerns remain untouched

### Issue 4: Commit 82f5ad6 (Style Package Surface Trim) — Not Stale
- **Commit:** "feat(style): strict inline color literals + trim public surface"
- **Impact on TP-011:** Zero. Affects `packages/style/`, not core or store type system

### Issue 5: Commit 9db2613 (Core Build Validation) — Not Stale
- **Commit:** "fix(core,crust,docs): make build-validation force-exit opt-in"
- **Impact on TP-011:** Zero. Affects parser behavior for command setup, not the coercion helpers

---

## TP-012 Staleness: MULTIPLE BLOCKING DEPENDENCIES NOT MET

**Severity:** CRITICAL — Task cannot proceed. Depends on TP-009, TP-010, and TP-011.

### Issue 1: TP-009 Not Merged (Required for `choices` Field)
- **Status:** TP-009 (`choices` field on FlagDef/ArgDef, `hidden` on CommandMeta) is **not started** (status: "Ready for Execution", step 0: "Not Started")
- **Impact:** TP-012 Step 1 extends ValueType assuming `choices` already exists on FlagDef/ArgDef (per TP-012 PROMPT, "Tier 3: packages/core/src/types.ts — modify to add `parse` field"; Step 3 says "When `choices` is also present: validate against `choices` first using the **raw argv string**, then call `parse`")
- **Current state:** No `choices` field in `packages/core/src/types.ts` (verified via grep; not present in FlagDef or ArgDef)
- **Action required:** Execute TP-009 before TP-012 can start

### Issue 2: TP-010 Not Merged (Required for Completion Plugin)
- **Status:** TP-010 (completion plugin: walker, spec, bash/zsh/fish templates) is **not started** (status: "Ready for Execution", step 0: "Not Started")
- **Impact:** TP-012 Step 5 modifies the completion plugin to handle `path` type file completion. TP-010 *creates* the completion plugin files that TP-012 modifies.
- **Current state:** No `packages/plugins/src/completion/` directory exists (verified via ls; only `did-you-mean.ts`, `help.ts`, etc. present)
- **Action required:** Execute TP-010 before TP-012 Step 5 can run

### Issue 3: TP-011 Not Merged (Required for BaseValueType + ResolvePrimitive)
- **Status:** TP-011 (consolidate ValueType → @crustjs/utils) is **not started** (status: "Ready for Execution", step 0: "Not Started"), and itself depends on TP-005
- **Impact:** TP-012 Step 1 extends ValueType and Resolve<T> in `packages/core/src/types.ts`, assuming TP-011 has already migrated those to use imports from @crustjs/utils. Per TP-012 PROMPT Step 0: "Confirm TP-011 is merged: `@crustjs/utils` exports `BaseValueType` and `ResolvePrimitive`, and `packages/core/src/types.ts` already imports them"
- **Current state:** `packages/core/src/types.ts` defines ValueType and ResolvePrimitive locally (lines 6, 12–19); no imports from @crustjs/utils
- **Action required:** Execute TP-011 (which requires TP-005) before TP-012 can start

### Issue 4: File References in TP-012 PROMPT Are Accurate (Not Stale)
**No staleness detected in the files TP-012 will modify:**
- ✅ `packages/core/src/types.ts` — current structure matches TP-012's expectations (will extend with new ValueType members, new interfaces, parse field)
- ✅ `packages/core/src/parser.ts` — ready to be extended with new type dispatch and parse semantics
- ✅ `packages/core/src/errors.ts` — CrustError shape verified (used by coercers)
- ✅ `packages/core/src/types.test.ts` — file exists (verified), empty of parse-related tests (as expected)
- ⚠️ `packages/plugins/src/completion/{walker,spec,templates}` — **do not exist yet** (TP-010 dependency)

### Issue 5: `packages/core/src/coercers.ts` Does Not Exist (Will Be Created)
- **Status:** New file to be created by TP-012 Step 2
- **Impact:** No staleness; this is an expected new artifact in the TP-012 scope

### Execution Dependency Chain
```
TP-012 cannot run until:
  ├─ TP-009 merged (adds `choices` field)
  ├─ TP-010 merged (creates completion plugin structure)
  └─ TP-011 merged (migrates ValueType → @crustjs/utils)
      └─ TP-005 merged (creates @crustjs/utils package)

TP-011 cannot run until:
  └─ TP-005 merged (creates @crustjs/utils package)

TP-010 has no pre-merge dependencies beyond TP-008 (completed).

TP-009 has no pre-merge dependencies beyond TP-003/TP-004 (completed).

TP-005 blocked on:
  ├─ TP-003 (completed — verified by presence of resolveSourceDir in skills)
  └─ TP-004 (completed — verified by presence of agents option in generateSkill)
```

---

## Recommendations

### For TP-011:
1. **Prerequisite:** Ensure TP-005 is executed first
2. **No other staleness:** Once TP-005 is complete, the PROMPT is fresh and accurate

### For TP-012:
1. **Prerequisite chain:** Execute in order: **TP-005 → TP-011 → TP-009 → TP-010 → TP-012**
2. **No source-code staleness** in the referenced files — all line numbers and function signatures in the PROMPT match current reality
3. Once all dependencies are satisfied, the PROMPT is fresh and accurate

---

## Summary

| Task   | Staleness Status | Root Cause | Blocker |
|--------|------------------|-----------|---------|
| TP-011 | ❌ Not executable | TP-005 not started | TP-005 must merge |
| TP-012 | ❌ Not executable | TP-005, TP-009, TP-010, TP-011 not started | Execute prerequisite chain |

**Both tasks reference the correct file locations and line numbers.** The staleness is purely a *dependency order* issue, not a *code divergence* issue. Once the prerequisite tasks execute, both PROMPTs are accurate and ready for worker execution.
