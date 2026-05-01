# Staleness Audit — TP-013, TP-014, TP-015

**Date:** 2026-05-06  
**Scope:** Validate/Prompts track post-PR #113 merge  
**Context:** PR #113 (TP-007) merged "single Standard Schema entry point + vendor-dispatch introspection" — this is the baseline for all three downstream tasks.

---

## Summary

| Task | Status | Severity | Action |
|------|--------|----------|--------|
| **TP-013** | ✅ **None** | — | Execute as written. No conflicts with PR #113. |
| **TP-014** | ⚠️ **Partial** | Medium | Task is sound; baseline context updated. Extend existing `introspect/registry.ts` (already created by PR #113) for `extractDefault()` and `"field"` kind. |
| **TP-015** | ⚠️ **Partial** | Low | Scope already reduced (demo dropped per 2026-05-03 amendment). Docs-only task is clear. Blocked on TP-013 + TP-014. |

---

## TP-013 — Staleness: **NONE**

### Status
**Ready to execute as written.** No staleness detected.

### Details

#### Current State
- `packages/prompts/src/prompts/input.ts` — Still has the old single-shape signature: `validate?: ValidateFn<string>` returning `Promise<string>`.
- `packages/prompts/src/core/types.ts` — Still exports only `ValidateFn<T>` (function-only shape).
- `packages/prompts/package.json` — Does NOT yet include `@standard-schema/spec` as a dependency.
- No `@standard-schema/spec` import exists in prompts source.

#### PR #113 Impact
PR #113 touched `@crustjs/validate` only (moved helpers into root entry point, created introspection registry). **Zero changes to `@crustjs/prompts`**. The validate package's refactor does not block or invalidate TP-013's plan.

#### Risk Assessment
**Low.** TP-013 is additive (polymorphic slot via function overload) and depends on nothing that PR #113 changed. The new `input({ validate: z.coerce.number() })` shape will work alongside existing `input({ validate: (v) => ... })` code after this lands.

### Recommendation
**EXECUTE AS WRITTEN** — no rewrites needed. All steps, dependencies, and technical decisions in the PROMPT are valid.

---

## TP-014 — Staleness: **PARTIAL**

### Status
**Task is sound, but baseline has shifted.** PR #113 already created the vendor-dispatch introspection foundation that TP-014 depends on. The task's goals remain unchanged; some implementation details now reference existing code instead of creating it new.

### Details

#### Current State (Pre-TP-014, Post-PR-#113)

**Validate package structure:**
- ✅ `packages/validate/src/introspect/registry.ts` — **Already exists** (created by PR #113). Implements `inferOptions(schema, kind: "arg" | "flag", label)` with vendor dispatch to `inferFromZod()` and `inferFromEffect()`.
- ✅ `packages/validate/src/introspect/zod.ts` — **Already exists** (created by PR #113). Introspects Zod schemas for `type`, `multiple`, `description`.
- ✅ `packages/validate/src/introspect/effect.ts` — **Already exists** (created by PR #113). Introspects Effect schemas.
- ❌ `extractDefault()` — **Does NOT exist yet.** This is TP-014's new addition (Step 2).
- ❌ `"field"` kind in `inferOptions()` — **Not supported yet.** Currently only handles `"arg" | "flag"`. TP-014 must extend to `"arg" | "flag" | "field"`.

**Old helpers still present (all targeted for deletion in TP-014):**
- ❌ `packages/validate/src/store.ts` — Still has the old `field()` (returns `ValidateFn`) and `fieldSync()` (returns `ValidateFn`). **Will be replaced** by new `field(schema, opts?)` factory that returns `FieldDef` (Step 3).
- ❌ `packages/validate/src/prompt.ts` — Still exports `parsePromptValue`, `parsePromptValueSync`, `promptValidator`. **Will be renamed/deleted** (Step 4).
- ❌ `packages/validate/src/index.ts` — Still re-exports the old helpers. **Will be trimmed** to the locked 8-function surface (Step 4).
- ❌ Subpath barrels — `packages/validate/src/{zod,effect,standard}/` directories still exist. **Will be deleted** (Step 5).

#### PR #113 Impact
**Partial completion of TP-014's foundation work.**
- PR #113's introspection registry is exactly what TP-014 Step 2 depends on: a vendor-aware dispatch mechanism. The registry is production-ready and will be extended (not rewritten) by TP-014.
- PR #113 did NOT implement default extraction (that's new in TP-014).
- PR #113 did NOT touch the old `field()`, `fieldSync()`, `parsePromptValue*`, `promptValidator` helpers — those remain for TP-014 to delete.
- PR #113's amendment in TP-014's PROMPT explicitly acknowledges this: "TP-014 must extend the registry to add `extractDefault()` and `"field"` kind" (see Amendment 1 in TP-014 PROMPT).

#### Risk Assessment
**Medium, but mitigated.** The introspection registry already exists, reducing the scope of Step 2 (Implement Vendor-Aware Default Extraction). The worker must:
1. **Extend** `registry.ts` (not create from scratch) — add `extractDefault()` function and extend the `kind` union to `"arg" | "flag" | "field"`.
2. **Enhance** `introspect/zod.ts` and `introspect/effect.ts` — add default extraction logic (Zod: walk `def` for `ZodDefault`; Effect: use `AST.getDefaultAnnotation`). These files already exist; new functions are insertions.
3. **Delete** all legacy helpers (Steps 3-5) — the old `field()`, `fieldSync()`, `parsePromptValue*`, `promptValidator`, subpath barrels, as planned.

The task's overall structure (9 steps, 8-function locked surface, sync-factory design) remains valid.

### Technical Context

**Zod default extraction (Zod 4 syntax — needed for Step 2):**
```typescript
// Current state after PR #113: introspect/zod.ts infers type, multiple, description
// TP-014 Step 2 will add:
function extractZodDefault(schema: StandardSchema): { ok: true; value: unknown } | { ok: false } {
  // Walk schema.def looking for a node with type === "default"
  // Zod 4: read def.defaultValue (a value, not a function like Zod 3)
  // Return { ok: true, value: ... } or { ok: false }
}
```

**Effect default extraction (via `AST.getDefaultAnnotation` — needed for Step 2):**
```typescript
// The wrapped Effect schema (from Schema.standardSchemaV1(...)) exposes .ast
// Use AST.getDefaultAnnotation(schema.ast) to detect optionalWith({default})
// Return { ok: true, value: ... } or { ok: false }
// NOTE: Effect's .annotations({ default }) style does NOT inject defaults; only optionalWith({default}) works
```

**Field factory signature (Step 3 — new shape replacing old `field()`):**
```typescript
// Old (pre-TP-014): field(schema) -> (value: unknown) => Promise<void>
// New (TP-014): field<S extends StandardSchema>(schema: S, opts?: FieldOptions<InferOutput<S>>) -> FieldDef
// Returns a full field definition object with { type, default?, validate, ... }
// Synchronous return, so default extraction must complete synchronously
```

### Recommendation
**REWRITE MINIMAL CONTEXT SECTION ONLY** — The PROMPT's main task description is accurate. However, update the "Amendment 1" section or add a new pre-execution note clarifying:

> **Pre-execution note (post-PR #113):** The introspection registry (`packages/validate/src/introspect/registry.ts`) and its vendor adapters already exist. Step 2 will **extend** this existing registry by:
> 1. Adding `extractDefault(schema): { ok: true; value: unknown } | { ok: false }` function (vendor-aware + sync fallback).
> 2. Extending `kind` union in `inferOptions(schema, kind, label)` to include `"field"` (currently only `"arg" | "flag"`).
> 3. Enhancing `introspect/zod.ts` and `introspect/effect.ts` to implement per-vendor default extraction.
>
> All other steps (3-9: factory rewrite, helper deletion, docs) remain unchanged.

**No breaking changes to the task's locked design decisions.** The sync-factory, TypeScript narrowing rules, and 8-function surface are all still valid.

---

## TP-015 — Staleness: **PARTIAL**

### Status
**Scope has been officially reduced (demo dropped).** Task is sound and correctly specified; it is **blocked on TP-013 + TP-014** as intended. When those tasks land, TP-015 is straightforward cross-reference verification.

### Details

#### Current State
- ✅ `packages/store/README.md` — Has old `field(schema)` examples that return validators. Will need updates when TP-014 ships (Step 1).
- ✅ `apps/docs/content/docs/modules/store.mdx` — Same old examples. Will need updates.
- ✅ `apps/docs/content/docs/modules/validate.mdx` — TP-014 will substantially rewrite this. TP-015 just verifies cross-links resolve (Step 1).
- ✅ `apps/docs/content/docs/modules/prompts.mdx` — TP-013 will add schema-validation section. TP-015 verifies integration (Step 1).
- ❌ `apps/demo-validate/` — **Never existed in this repo**; dropped per Amendment 1 (2026-05-03, operator decision).

#### PR #113 Impact
None directly on TP-015. The task is pure documentation. It depends on TP-013 and TP-014 being merged first.

#### Amendment 1 Impact (2026-05-03)
The PROMPT originally mentioned a runnable demo at `apps/demo-validate/`. This was dropped:
- Original plan: Rewrite a demo app showing the aligned APIs (`input({ validate: schema })`, `field(schema, opts?)`, `parseValue(schema, v)`).
- Current plan (post-amendment): Docs-only. The demo is a separate follow-up if desired.
- **Result:** TP-015's scope is now smaller and clearer. No more app-level changes; just cross-package doc updates.

### Technical Context

**TP-015 will verify (after TP-013 + TP-014 land):**
1. `packages/store/README.md` examples show the new `field(schema, opts?)` factory shape, not the old validator-only `field()`.
2. `apps/docs/content/docs/modules/store.mdx` matches the README examples.
3. `apps/docs/content/docs/modules/validate.mdx` (rewritten by TP-014) cross-links to `store.mdx` correctly.
4. `apps/docs/content/docs/modules/prompts.mdx` (updated by TP-013) shows `input({ validate: schema })` examples and cross-links to `validate.mdx` for `parseValue()`.
5. `packages/validate/README.md` and `packages/prompts/README.md` migration sections correctly describe the new APIs.
6. No stale references to `parsePromptValue`, `promptValidator`, `fieldSync`, or subpath imports remain anywhere.

### Recommendation
**NO REWRITES NEEDED.** The PROMPT is accurate; the amendment is already documented. TP-015 is **unblocked** pending TP-013 and TP-014.

---

## Dependency Graph

```
PR #113 (TP-007) ✅ MERGED
    ↓
    ├─→ TP-013 (prompts polymorphic) — 🟢 READY (no conflicts)
    └─→ TP-014 (validate API align) — 🟡 READY (extend existing registry)
            ↓
            └─→ TP-015 (docs cross-ref) — ⏸️ BLOCKED (awaits TP-013 + TP-014)
```

---

## Execution Sequence

1. **Execute TP-013** first (no blockers).
   - Adds polymorphic `validate:` slot to `input()` and `password()`.
   - Includes docs updates for `prompts.mdx`.
   - New test coverage for schema-based validation.

2. **Execute TP-014** next (depends only on PR #113, which is merged).
   - Extend existing `introspect/registry.ts` with `extractDefault()` and `"field"` kind.
   - Replace old `field()` with new `field(schema, opts?)` factory.
   - Delete legacy helpers (`fieldSync()`, `promptValidator`, `parsePromptValue*`).
   - Includes comprehensive docs rewrite for `validate.mdx`.
   - Update `store.mdx` to reflect new `field()` shape.

3. **Execute TP-015** last (depends on TP-013 + TP-014 merged).
   - Verify all cross-links in docs resolve correctly.
   - Update `packages/store/README.md` and `packages/prompts/README.md` if TP-013/TP-014 left any stale examples.
   - Final `rg "parsePromptValue|promptValidator|fieldSync|@crustjs/validate/(zod|effect|standard)"` sweep.

---

## Key Findings

| Finding | Implication | Action |
|---------|-------------|--------|
| PR #113 already created `introspect/registry.ts` with vendor dispatch | TP-014's Step 2 will **extend**, not create from scratch | No task rewrite; update context note |
| Default extraction logic is entirely new (not in PR #113) | TP-014 Step 2 is the full implementation for Zod/Effect/fallback | No change; proceed as planned |
| Demo (`apps/demo-validate/`) was dropped | TP-015 is docs-only (smaller scope than PROMPT suggests) | Docs-only task is clear; no issues |
| Old `field()`, `fieldSync()`, etc. still in `index.ts` exports | TP-014 Step 4 + 5 will delete all these | No blocking surprises |
| Prompts still has single-typed `validate?: ValidateFn<string>` | TP-013 will add polymorphic overload via `StandardSchemaV1 \| ValidateFn` | No conflicts; proceed as planned |
| All three PROMPT documents are recent (2026-05-02) | Amendments and context reflect current state | Use as-is with minimal clarifications |

---

## Summary Table

| Task | Staleness | Blockers | Scope Change | Recommendation |
|------|-----------|----------|--------------|-----------------|
| **TP-013** | None | ✅ Zero | None | Execute as written |
| **TP-014** | Partial (baseline context updated by PR #113) | ✅ Zero (PR #113 merged) | No | Extend existing registry; proceed with 9 steps |
| **TP-015** | Partial (demo dropped, docs-only confirmed) | ⏸️ TP-013 + TP-014 | Reduced (docs-only) | Wait for TP-013/014; execute verified plan |

---

## Appendix: Files to Modify (Summary)

### TP-013
- `packages/prompts/src/prompts/input.ts` — Add polymorphic overloads
- `packages/prompts/src/prompts/password.ts` — Add polymorphic overloads
- `packages/prompts/src/core/types.ts` — Export schema type helpers
- `packages/prompts/package.json` — Add `@standard-schema/spec` dep
- `packages/prompts/README.md` — Schema examples
- `apps/docs/content/docs/modules/prompts.mdx` — Schema section
- `.changeset/*.md` — Minor bump for `@crustjs/prompts`

### TP-014
- `packages/validate/src/introspect/registry.ts` — **EXTEND** (add `extractDefault()` + `"field"` kind)
- `packages/validate/src/introspect/zod.ts` — **ENHANCE** (add Zod default extraction)
- `packages/validate/src/introspect/effect.ts` — **ENHANCE** (add Effect default extraction)
- `packages/validate/src/schema-types.ts` — Add `FieldOptions<T>` interface
- `packages/validate/src/store.ts` — **REPLACE** `field()`/`fieldSync()`; implement new factory
- `packages/validate/src/parse.ts` — **CREATE** (move `parsePromptValue` → `parseValue`)
- `packages/validate/src/prompt.ts` — **DELETE**
- `packages/validate/src/index.ts` — Trim to 8-function root surface
- `packages/validate/src/zod/`, `effect/`, `standard/` — **DELETE directories**
- `packages/validate/README.md` — Full rewrite + migration section
- `apps/docs/content/docs/modules/validate.mdx` — Full rewrite + migration section
- `packages/validate/package.json` — Bump to 0.2.0; remove subpath exports
- `.changeset/*.md` — Minor bump with breaking-change notes

### TP-015
- `packages/store/README.md` — Update `field()` examples
- `apps/docs/content/docs/modules/store.mdx` — Update `field()` examples
- `apps/docs/content/docs/modules/validate.mdx` — Verify (TP-014 owns rewrite)
- `apps/docs/content/docs/modules/prompts.mdx` — Verify (TP-013 owns rewrite)
- `packages/validate/README.md` — Verify migration section (TP-014 owns)
- `packages/prompts/README.md` — Verify migration section (TP-013 owns)

---

**Audit completed.** All three tasks are executable; TP-013 and TP-014 can proceed in parallel or sequence; TP-015 is blocked on both.
