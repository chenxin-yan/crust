# TP-013: prompts-polymorphic-validate — Status

**Current Step:** ✅ Delivered (PR #117, merged 2026-05-07)
**Status:** ✅ Complete
**Last Updated:** 2026-05-07 (post-merge cleanup by supervisor)
**Review Level:** 1
**Review Counter:** 1
**Iteration:** 1
**Size:** S

> **Note (supervisor):** This task was delivered via PR #117 against `main`
> as `feat(prompts): polymorphic validate slot using Standard Schema`. Batch
> `20260506T215038` (single lane, 9m 60s, $3.33) produced the orch branch;
> the manual PR recovery (per the established `feat/*` off `origin/main`
> pattern) only carried user-visible files, so the step-by-step checkboxes
> below were never retroactively flipped. This top-of-file marker is the
> canonical delivery record.
>
> Verified against merged code: 11 files / +556 / −56; `packages/prompts`
> tests 315 → 330 (15 new); root surface includes inline `isStandardSchema`
> at `packages/prompts/src/core/types.ts:142`; no `@crustjs/validate`
> runtime import in prompts; `@standard-schema/spec ^1.1.0` is the only
> new runtime dep.

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it — aim for
> 2-5 outcome-level items per step, not exhaustive implementation scripts.

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] Required files and paths exist
- [ ] `bun install` succeeds
- [ ] Existing `@crustjs/prompts` test suite passes pre-edit

---

### Step 1: Add `@standard-schema/spec` dependency
**Status:** ⬜ Not Started

- [ ] Add `@standard-schema/spec` `^1.1.0` to `packages/prompts/package.json` dependencies (matches validate)
- [ ] Add `zod` `^4.0.0` to `packages/prompts/package.json` devDependencies (test fixtures only)
- [ ] `bun install` updates `bun.lock` cleanly
- [ ] Verify import smoke from `packages/prompts/src/`

---

### Step 2: Make `input()` polymorphic on `validate`
**Status:** ⬜ Not Started

- [ ] `InputOptions<T = string>` is generic; overloads added for schema vs function shape
- [ ] Inline `isStandardSchema()` discriminator (3-line guard, no `@crustjs/validate` import)
- [ ] Schema path: `await schema['~standard'].validate(submitValue)`; on issues, render `issues[0].message`; on success, submit `result.value`
- [ ] Function-shape behavior unchanged (regression-free)

---

### Step 3: Apply the same change to `password()`
**Status:** ⬜ Not Started

- [ ] `password.ts` mirrors `input.ts`'s polymorphic dispatch
- [ ] `confirm()` / `select()` / `multiselect()` / `filter()` untouched

---

### Step 4: Tests for the schema path
**Status:** ⬜ Not Started

- [ ] `input.test.ts` covers: schema-valid, schema-invalid (with first-issue render), schema-with-coerce (transformed return), async refinement
- [ ] `password.test.ts` covers the same three cases minimum
- [ ] Existing function-shape tests still green

---

### Step 5: Documentation
**Status:** ⬜ Not Started

- [ ] `packages/prompts/README.md` Schema-validation section
- [ ] `apps/docs/content/docs/modules/prompts.mdx` Schema-validation section
- [ ] Changeset (minor bump for `@crustjs/prompts`)

---

### Step 6: Testing & Verification
**Status:** ⬜ Not Started

- [ ] `bun run check` clean
- [ ] `bun run check:types` clean
- [ ] `bun run test` full suite green
- [ ] Manual TTY smoke against `input({ validate: z.coerce.number() })` confirms typed return

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
| 2026-05-02 | Task staged | PROMPT.md and STATUS.md created |
| 2026-05-02 | Oracle audit applied | `@standard-schema/spec` version aligned to ^1.1.0; `zod` added as test devDep |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
