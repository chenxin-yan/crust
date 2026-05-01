# TP-015: dx-alignment-demo-and-docs — Status

**Current Step:** ✅ Obsoleted by PR #118 (2026-05-07)
**Status:** ✅ Complete (TASK_OBSOLETE)
**Last Updated:** 2026-05-07 (post-PR #118 staleness audit)
**Review Level:** 1
**Review Counter:** 0
**Iteration:** 0
**Size:** XS

> **Note (supervisor):** When TP-014 (PR #118) landed, the worker chose to
> include all cross-package docs/demo updates in the same PR — specifically
> the rewrites of `packages/{validate,store}/README.md` and
> `apps/docs/content/docs/modules/{validate,store}.mdx` to use the new
> `field()` factory shape and the locked 8-function root surface. The
> follow-up commit `1678945 docs: clean up validate docs` polished the
> migration table formatting.
>
> A scout audit on 2026-05-07 verified that **every Step 1 deliverable was
> already complete on main** before TP-015 became unblocked: no `parsePromptValue`,
> `promptValidator`, `parsePromptValueSync`, or `fieldSync` references remain
> in any production doc; `field()` examples consistently use the new factory
> shape; cross-links between `validate.mdx`, `store.mdx`, and `prompts.mdx`
> resolve cleanly; the migration sections in both READMEs are accurate.
>
> Full audit: `.pi/supervisor/scout-reports/post-pr118-tp015.md`.

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it — aim for
> 2-5 outcome-level items per step, not exhaustive implementation scripts.

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] TP-013 merged (prompts polymorphic `validate:` slot live)
- [ ] TP-014 merged (validate API alignment live)
- [ ] `bun run test` green pre-edit

---

### Step 1: Update cross-package docs
**Status:** ⬜ Not Started

- [ ] `packages/store/README.md` `field(...)` examples rewritten to the new `field(schema)` factory shape
- [ ] `apps/docs/content/docs/modules/store.mdx` mirrored
- [ ] `validate.mdx` and `prompts.mdx` cross-links verified resolve correctly
- [ ] `packages/validate/README.md` and `packages/prompts/README.md` migration sections verified post-alignment

---

### Step 2: Verification
**Status:** ⬜ Not Started

- [ ] `bun run check` clean
- [ ] `bun run check:types` clean
- [ ] `bun run test` full suite green
- [ ] `apps/docs/` build clean with no broken links
- [ ] `rg "parsePromptValue|promptValidator|parsePromptValueSync|fieldSync"` returns no hits anywhere

---

### Step 3: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] "Must Update" docs modified
- [ ] "Check If Affected" docs reviewed
- [ ] Discoveries logged
- [ ] Changeset added only if README change warrants one per repo convention

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
| 2026-05-02 | Task staged | PROMPT.md and STATUS.md created (blocked on TP-013 + TP-014) |
| 2026-05-03 | Scope rewrite | Demo dropped (apps/demo-validate/ never existed in git); task is now docs-only |

---

## Blockers

- **TP-013:** prompts polymorphic `validate:` slot must be merged
- **TP-014:** `@crustjs/validate` API alignment must be merged

---

## Notes

*Reserved for execution notes*
