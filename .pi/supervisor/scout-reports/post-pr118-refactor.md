# Refactor track audit — post-#118

## TP-011: NO_AMENDMENT_NEEDED

**Evidence:**

1. **File Scope verified**: TP-011 PROMPT lines 70–89 explicitly scope the migration to `packages/core/` and `packages/store/` only. `packages/validate/` is NOT listed under "Modified files."

2. **Validate deferral explicit**: TP-011 PROMPT line 215 (Do NOT section) states: "Do NOT plumb consolidation through `@crustjs/validate` — its 3 internal `ValueType` copies are deferred per the type-system expansion review (logged in CONTEXT.md tech debt). TP-007 will reduce these from 3 → 1; a future cleanup task can plumb through utils." Line 218 reiterates: "Do NOT touch `packages/validate/`, the zod adapters, or the effect adapters. Out of scope."

3. **Third copy confirmed**: Validate's `packages/validate/src/schema-types.ts` line 30 contains an identical private `ValueType` literal union (`"string" | "number" | "boolean"`), created by PR #118. It is also referenced by `InferredOptions` (registry.ts line 20), `ZodInferResult` (zod.ts line 21), and `EffectInferResult` (effect.ts line 60).

4. **Prerequisite not yet done**: TP-005 (create `packages/utils/`) has not been completed — there is no `packages/utils/src/` directory yet. TP-011 explicitly depends on TP-005 (line 45). This is a known blocker, not a staleness issue.

5. **PR #118 scope**: PR #118 refactored validate's introspection infrastructure (deleted `effect/index.ts`, `standard/index.ts`, `zod/index.ts`; added introspect registry, new `schema-types.ts` with private `ValueType` copy). These changes do NOT affect TP-011's mission because TP-011 does not touch validate.

**Recommendation:** The PROMPT is **complete and accurate** for its intended scope (core + store only). The deferral of validate consolidation is intentional and clearly documented. No amendments required.

---

## TP-012: NO_AMENDMENT_NEEDED

**Evidence:**

1. **Scope excludes validate**: TP-012 PROMPT line 575 (Do NOT section) states: "Do NOT modify the `@crustjs/validate` package or its types." Line 567 reiterates: "Do NOT plumb consolidation through `@crustjs/validate` (deferred per CONTEXT.md tech debt)."

2. **No deleted API dependencies**: TP-012 references validate only in documentation (lines 392, 399: discussing "Custom types via `parse`" vs. "`@crustjs/validate`" as a complementary tool). TP-012 does NOT import or depend on validate's code. PR #118's deletions of `prompt.ts`, `effect/index.ts`, `standard/index.ts`, `zod/index.ts` do not affect TP-012.

3. **No field() integration**: TP-012 does not reference validate's `field()` function, `FieldDef`, or `FieldOptions`. The reshaping of `field()` by PR #118 (now a factory using introspection registry's `kind: "field"` dispatch) is orthogonal to TP-012's core-only scope.

4. **Type extension scope**: TP-012 extends core's `ValueType` from `"string" | "number" | "boolean"` to `BaseValueType | "url" | "path" | "json"` (line 56–57). Validate's `InferredOptions` and `FieldOptions` (schema-types.ts) retain the narrower 3-type literal locally. This is intentional: validate's introspection is limited to the base types; users supplying custom parsers to `field()` must declare type via `FieldOptions.type` explicitly.

5. **No compile-time gating needed**: Unlike core's `parse?: never` enforcement on non-string variants, validate does not need `parse` fields because `FieldOptions` does not define a `parse` key at all (by design — validation flows through the schema, not through a parse escape hatch).

6. **Dependencies unaffected**: TP-012 depends on TP-009 (choices field), TP-010 (completion plugin), and TP-011 (BaseValueType from utils). None of these changes were blocked by PR #118.

**Recommendation:** The PROMPT is **complete and accurate**. Cross-package coordination is not needed: validate's type inference is intentionally independent of core's extended `ValueType`. No amendments required.

---

## Summary

Post-PR #118, both prompts remain aligned with the codebase. TP-011 is correctly scoped to core + store, with validate consolidation explicitly deferred to TP-007 per tech debt. TP-012 is correctly scoped to core only, with validate documented as a complementary (not integrated) tool. PR #118's restructuring of validate's introspection infrastructure and schema-types.ts does not introduce staleness or unanticipated cross-package dependencies into either task. Both tasks can proceed to execution without amendment.

---

## Suggested amendments (if any)

None required. Both prompts are appropriate for post-#118 execution.

However, **optional documentation improvement for TP-011** (non-critical): The PROMPT could explicitly note in the "Context to Read First" section that validate's schema-types.ts contains a third `ValueType` copy (for future reference by TP-007 / the cleanup task). This would make the deferral rationale even clearer to workers. Current language (line 215) is already explicit, but a forward-reference would enhance clarity:

> **Suggested optional addition to TP-011 PROMPT § Context to Read First, after line 60:**
> - `packages/validate/src/schema-types.ts` (lines 12–30) — contains a private third copy of `ValueType` identical to core's and store's. Consolidation deferred to TP-007 and a future cleanup task per CONTEXT.md tech debt; this task explicitly excludes it (see Do NOT § line 215).
