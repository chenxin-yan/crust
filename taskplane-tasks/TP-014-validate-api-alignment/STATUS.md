# TP-014: validate-api-alignment — Status

**Current Step:** ✅ Delivered (PR #118, merged 2026-05-07)
**Status:** ✅ Complete
**Last Updated:** 2026-05-07 (post-merge cleanup by supervisor)
**Review Level:** 2
**Review Counter:** 1
**Iteration:** 1
**Size:** L

> **Note (supervisor):** Delivered via PR #118 against `main` as
> `feat(validate)!: align public API — drop legacy helpers, lock 8-function
> surface`. Batch `20260507T013256` (single lane, 21m 21s, $14.16) produced
> the orch branch; manual PR recovery (per the established `feat/*` off
> `origin/main` pattern) carried only user-visible files plus a beneficial
> `.gitignore` + `biome.json` cleanup.
>
> Includes Amendment 1 from supervisor pre-flight (2026-05-03):
> `extractDefault()` synchronous default extraction + `kind: "field"`
> registry dispatch.
>
> Verified against merged code: 32 files / +1493 / −2405 (net deletion);
> public surface introspection confirms exactly the locked 8 functions
> (`arg, commandValidator, field, flag, isStandardSchema, parseValue,
> validateStandard, validateStandardSync`); legacy `/zod`, `/effect`,
> `/standard` subpaths and source dirs deleted; `effect` peer-dep removed;
> validate 318/0, store 218/0, prompts 330/0, core 464/0; type-check 21/21
> fresh.
>
> Follow-up commit `1678945` (docs: clean up validate docs) landed
> directly on main.

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it — aim for
> 2-5 outcome-level items per step, not exhaustive implementation scripts.

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] Working branch includes merged TP-007 / PR #113 (validate single-root layout, vendor-dispatch introspection registry, deprecated subpath barrels in src/{zod,effect,standard}/)
- [ ] Required files and paths exist
- [ ] `@crustjs/validate` test suite green pre-edit
- [ ] No conflicting changes from TP-013 (different package, additive only)

---

### Step 1: Add `FieldOptions<T>` to `schema-types.ts`
**Status:** ⬜ Not Started

- [ ] `FieldOptions<T = unknown>` interface added, mirroring `ArgOptions` / `FlagOptions`
- [ ] Re-exported from `index.ts`

---

### Step 2: Implement SYNCHRONOUS vendor-aware default extraction
**Status:** ⬜ Not Started

- [ ] `inferOptions` `kind` parameter extended to `"arg" | "flag" | "field"`
- [ ] `extractDefault(schema): { ok: true, value: unknown } | { ok: false }` (SYNC return) added to `introspect/registry.ts`
- [ ] Zod adapter walks `def` for `ZodDefault`, returns `defaultValue`
- [ ] Effect adapter uses `AST.getDefaultAnnotation` for `optionalWith({default})` schemas
- [ ] Sync fallback: `validate(undefined)` only when result is non-Promise; falsy-default detection via `result.issues`
- [ ] Default-extraction matrix tests covering Zod (default + falsy + none + async-only), Effect (optionalWith + annotation-only)

---

### Step 3: Implement the new `field(schema, opts?)` factory
**Status:** ⬜ Not Started

- [ ] Old `field` (validator-only) replaced; `fieldSync` deleted
- [ ] New SYNCHRONOUS `field(schema, opts?)` returns a value satisfying store's discriminated `FieldDef` union
- [ ] Throws `CrustError("DEFINITION")` when type cannot be resolved; silent fallback when default cannot
- [ ] Function overloads: no-opts variant, opts-with-default variant (narrows TS), opts-without-default variant
- [ ] Tests cover both runtime and TS-narrowing behavior, including the documented limitation that schema-derived defaults do NOT narrow at the type level

---

### Step 4: Rename `parsePromptValue` → `parseValue`; prune `prompt.ts`
**Status:** ⬜ Not Started

- [ ] `parseValue` lives in new `packages/validate/src/parse.ts`
- [ ] `prompt.ts` and `prompt.test.ts` deleted
- [ ] `parse.test.ts` covers throw-on-invalid + transformed-output paths
- [ ] `index.ts` re-exports updated to the locked 8-function root surface
- [ ] `rg "parsePromptValue|promptValidator|parsePromptValueSync"` returns no hits in `packages/validate/src/`

---

### Step 5: Delete deprecated subpath barrels and clean up package metadata
**Status:** ⬜ Not Started

- [ ] `packages/validate/src/zod/`, `effect/`, `standard/` directories deleted entirely
- [ ] `packages/validate/package.json`: `./zod`, `./effect`, `./standard` removed from `exports`
- [ ] `effect` removed from `peerDependencies` and `peerDependenciesMeta`
- [ ] `tests/no-static-effect-import.test.ts` still passes (now stricter with shim gone)

---

### Step 6: Cross-package usage check
**Status:** ⬜ Not Started

- [ ] `rg "parsePromptValue|parsePromptValueSync|promptValidator|fieldSync"` across the monorepo (excluding `apps/demo-validate/`) — every hit fixed or explicitly deferred
- [ ] `rg "@crustjs/validate/(zod|effect|standard)" --type ts --type md --type mdx` returns zero hits outside demo
- [ ] `@crustjs/store` and `@crustjs/prompts` packages still have zero runtime dep on `@crustjs/validate`

---

### Step 7: Documentation
**Status:** ⬜ Not Started

- [ ] `packages/validate/README.md` rewritten with new surface + migration section (subpaths, renames, deletions, schema-default TS limitation)
- [ ] `apps/docs/content/docs/modules/validate.mdx` mirrored
- [ ] Changeset for `@crustjs/validate` minor bump with explicit breaking-change notes

---

### Step 8: Testing & Verification
**Status:** ⬜ Not Started

- [ ] `bun run check` clean
- [ ] `bun run check:types` clean
- [ ] `bun run test` full suite green (including `tests/no-static-effect-import.test.ts`)
- [ ] `bun run build` clean for `@crustjs/validate`
- [ ] `rg "@crustjs/validate/(zod|effect|standard)"` returns zero hits

---

### Step 9: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] "Must Update" docs modified
- [ ] "Check If Affected" docs reviewed
- [ ] Discoveries logged
- [ ] Final `rg "^export" packages/validate/src/index.ts` matches the locked 8-function root surface

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
| 2026-05-02 | Task staged | PROMPT.md and STATUS.md created |
| 2026-05-02 | Oracle audit applied | Sync/async + TS narrowing fixed; subpath deletion added; size M→L; locked surface 7→8 |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
