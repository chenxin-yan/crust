# TP-008: Rename `autoCompletePlugin` to `didYouMeanPlugin` — Status

**Current Step:** ✅ Delivered (PR #115, merged 2026-05-03)
**Status:** ✅ Complete
**Last Updated:** 2026-05-03 (post-merge cleanup by supervisor)
**Review Level:** 1
**Review Counter:** 1
**Iteration:** 1

> **Note (supervisor):** This task was delivered via PR #115 against `main`.
> The orch branch's full STATUS update never reached `taskplane` because the
> manual PR recovery only carried user-visible files (per established
> repo pattern from PR #113 / #114). This top-of-file marker is the canonical
> delivery record; the step-by-step checkboxes below are stale and have
> not been retroactively filled.
**Size:** S

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it — aim for
> 2-5 outcome-level items per step, not exhaustive implementation scripts.

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] Required files exist (per File Scope)
- [ ] Dependencies satisfied (none)
- [ ] Plugins-package tests green before changes
- [ ] Repo-wide grep for `autoCompletePlugin` / `AutoCompletePluginOptions` recorded in Notes

---

### Step 1: Rename source file and exports
**Status:** ⬜ Not Started

- [ ] `git mv` `autocomplete.ts` → `did-you-mean.ts`
- [ ] Function + type renamed inside the file; internal comments updated
- [ ] `index.ts` exports `didYouMeanPlugin` / `DidYouMeanPluginOptions` and deprecated aliases (value + type) with `@deprecated` JSDoc
- [ ] Targeted plugins tests pass

---

### Step 2: Update tests, README, and docs
**Status:** ⬜ Not Started

- [ ] `plugins.test.ts` references renamed
- [ ] New `did-you-mean.test.ts` with smoke test + alias-equivalence test
- [ ] `packages/plugins/README.md` plugin-table entry updated
- [ ] `.mdx` page renamed via `git mv` with title/frontmatter updated and migration note added
- [ ] Targeted plugins tests pass

---

### Step 3: Add changeset and run full verification
**Status:** ⬜ Not Started

- [ ] Changeset added (`@crustjs/plugins`: minor) with the specified body
- [ ] FULL test suite passing (`bun run check && bun run check:types && bun run test`)
- [ ] Build passes (`bun run build`)
- [ ] All failures fixed

---

### Step 4: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Final grep confirms no stray `autoCompletePlugin` / `AutoCompletePluginOptions` references outside the deprecation aliases and alias-equivalence test
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
| 2026-04-29 | Task staged | PROMPT.md and STATUS.md created |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes — record Step 0 grep findings here.*
