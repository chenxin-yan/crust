# TP-017: Extract `@crustjs/schema-utils` package — Status

**Current Step:** ✅ Delivered (PR #123, merged 2026-05-12)
**Status:** ✅ Complete (merged to main via PR #123 — commit `3421dbf`)

> **Note (supervisor):** Merged 2026-05-12 as
> `feat(schema-utils): new package; extract Standard Schema introspection from validate`.
> Side-effect: also relocated `field()` from validate → store (the field-migration
> deliverable of TP-018). TP-018's remaining scope is now transform-persistence +
> `store.fields()` introspection — see TP-018 STATUS.md Amendment 2.
**Last Updated:** 2026-05-07
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** M

> **Hydration:** Checkboxes represent meaningful outcomes, not individual file
> moves. Workers expand steps when runtime discoveries warrant it — aim for
> 2-5 outcome-level items per step.

---

### Step 0: Preflight
**Status:** ✅ Complete (merged)

- [ ] Required files and paths exist
- [ ] Pre-edit test suite green (validate package, --changed)
- [ ] TP-014 landed (locked validate surface present)

---

### Step 1: Scaffold `@crustjs/schema-utils` package
**Status:** ✅ Complete (merged)

- [ ] `packages/schema-utils/package.json` created with version 0.0.1, ESM, deps
- [ ] `tsconfig.json`, `bunup.config.ts`, `README.md` mirror `@crustjs/utils`
- [ ] Empty `src/index.ts` barrel created
- [ ] `bun install` registers the workspace package

---

### Step 2: Move introspection sources verbatim
**Status:** ✅ Complete (merged)

- [ ] `registry.ts` → `schema-utils/src/introspect.ts` (file rename, internal imports rewritten)
- [ ] `zod.ts` → `schema-utils/src/zod.ts` verbatim
- [ ] `effect.ts` → `schema-utils/src/effect.ts` verbatim
- [ ] `registry.test.ts` → `schema-utils/src/introspect.test.ts` verbatim, passes
- [ ] `validate/src/introspect/` directory deleted
- [ ] `schema-utils/src/types.ts` mirrors `validate/src/types.ts`

---

### Step 3: Move assertions and issue-normalization helpers
**Status:** ✅ Complete (merged)

- [ ] `assertions.ts` (moved `assertStandardSchema`, `isStandardSchema`)
- [ ] `issues.ts` (moved `normalizeStandardIssues`, `normalizeStandardPath`, `ValidationIssue` type if split lands there)
- [ ] `validate/src/validate.ts` re-exports the moved helpers; keeps `validateStandard`/`Sync`, `success`, `failure`

---

### Step 4: Wire validate to depend on schema-utils
**Status:** ✅ Complete (merged)

- [ ] Workspace dep added to `validate/package.json`
- [ ] `schema-utils/src/index.ts` populated with the full public surface
- [ ] `validate/src/types.ts` re-exports types from schema-utils (no duplicates)
- [ ] TP-014 locked root surface in `validate/src/index.ts` byte-identical
- [ ] Targeted tests pass (`validate test`, `validate check:types`)

---

### Step 5: Docs registration
**Status:** ✅ Complete (merged)

- [ ] `apps/docs/.../modules/schema-utils.mdx` created
- [ ] `meta.json` updated
- [ ] `README.md` and `CONTRIBUTING.md` package lists updated if they enumerate

---

### Step 6: Changeset
**Status:** ✅ Complete (merged)

- [ ] `bunx changeset` produces single combined entry
- [ ] `@crustjs/schema-utils` initial 0.0.1
- [ ] `@crustjs/validate` minor bump with "no API change" note

---

### Step 7: Testing & Verification
**Status:** ✅ Complete (merged)

- [ ] FULL test suite passing
- [ ] `bun run check` clean
- [ ] `bun run check:types` clean
- [ ] `bun run build` clean
- [ ] Manual sanity: `field(z.string().describe("x")).description === "x"`
- [ ] All failures fixed

---

### Step 8: Documentation & Delivery
**Status:** ✅ Complete (merged)

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

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
