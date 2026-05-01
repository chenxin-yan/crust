# TP-011: Consolidate type primitives into `@crustjs/utils` — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-04-29
**Review Level:** 1
**Review Counter:** 0
**Iteration:** 0
**Size:** M

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it — aim for
> 2-5 outcome-level items per step, not exhaustive implementation scripts.

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] TP-005 complete; `packages/utils/` exists with a working `src/index.ts`
- [ ] `bun install` clean at repo root
- [ ] All existing core + store tests pass on the current branch (baseline)

---

### Step 1: Create the shared primitives module in `@crustjs/utils`
**Status:** ⬜ Not Started

- [ ] `packages/utils/src/primitive.ts` exports `BaseValueType`, `ResolvePrimitive`, `tryCoerceNumber`, `coerceBooleanString`
- [ ] `packages/utils/src/primitive.test.ts` covers the 6 required runtime assertions plus a type-level distributivity test for `ResolvePrimitive`
- [ ] `packages/utils/src/index.ts` re-exports everything from `./primitive.ts`
- [ ] `packages/utils/README.md` has a "Type primitives" section listing the four new exports
- [ ] `cd packages/utils && bun test` green

---

### Step 2: Migrate `@crustjs/core` to use the shared primitives
**Status:** ⬜ Not Started

- [ ] `packages/core/src/types.ts` imports `BaseValueType` and `ResolvePrimitive` from `@crustjs/utils`; `ValueType` re-exported as alias for `BaseValueType`; local declarations removed
- [ ] `packages/core/src/parser.ts` `coerceValue()` wraps `tryCoerceNumber` (still throws `CrustError("PARSE", ...)` on `undefined`) and uses `coerceBooleanString`
- [ ] `packages/core/package.json` lists `"@crustjs/utils": "workspace:*"` in `dependencies`
- [ ] `cd packages/core && bun test` green — no test file modified

---

### Step 3: Migrate `@crustjs/store` to use the shared primitives
**Status:** ⬜ Not Started

- [ ] `packages/store/src/types.ts` imports `BaseValueType` and `ResolvePrimitive` from `@crustjs/utils`; `ValueType` re-exported as alias; local declarations removed
- [ ] `packages/store/src/store.ts` `coerceByType()` uses `tryCoerceNumber(v) ?? v` to preserve silent-string-fallback, and `coerceBooleanString` for booleans
- [ ] `packages/store/package.json` lists `"@crustjs/utils": "workspace:*"` in `dependencies`
- [ ] `cd packages/store && bun test` green — no test file modified

---

### Step 4: Testing & Verification
**Status:** ⬜ Not Started

- [ ] `bun run check` clean
- [ ] `bun run check:types` clean
- [ ] `bun run test` — FULL suite green
- [ ] `bun run build` green
- [ ] 3 changesets staged: utils minor, core patch, store patch (each referencing TP-011)

---

### Step 5: Documentation & Delivery
**Status:** ⬜ Not Started

> ⚠️ Hydrate: On entry, check whether `apps/docs/content/docs/modules/utils.mdx` exists. If it does, expand to include a checkbox for appending the primitives section there. If it doesn't, log that finding in Discoveries and skip the docs-site update.

- [ ] `packages/utils/README.md` "Type primitives" section verified accurate
- [ ] `apps/docs/content/docs/modules/utils.mdx` reviewed (append section if present, skip + log if absent)
- [ ] `apps/docs/content/docs/api/*.mdx` quickly grepped for `ValueType` references — no change required since re-export is transparent
- [ ] Discoveries logged below

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
| 2026-04-29 | Task staged | PROMPT.md and STATUS.md created |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
