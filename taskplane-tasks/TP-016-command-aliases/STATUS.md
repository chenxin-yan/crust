# TP-016: Add `aliases` to commands and subcommands — Status

**Current Step:** ✅ Delivered (PR #116, merged 2026-05-07)
**Status:** ✅ Complete
**Last Updated:** 2026-05-07 (post-merge cleanup by supervisor)
**Review Level:** 2
**Review Counter:** 1
**Iteration:** 1
**Size:** M

> **Note (supervisor):** This task was delivered via PR #116 against `main`
> as `feat(core,plugins,man): add aliases to commands and subcommands`.
> Manual PR recovery (per the established `feat/*` off `origin/main`
> pattern) only carried user-visible files, so the step-by-step checkboxes
> below were never retroactively flipped. This top-of-file marker is the
> canonical delivery record.

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it — aim for
> 2-5 outcome-level items per step, not exhaustive implementation scripts.

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] Verify Tier 3 files exist; record actual line numbers in Notes
      (`CommandMeta`, `resolveCommand` exact-match line, `.command()`
      duplicate-name check, `formatCommandsSection`)
- [ ] Confirm flag-alias collision precedents in `parser.ts` and `types.ts`
- [ ] Confirm `@crustjs/man` and `@crustjs/plugins` are in scope
- [ ] `bun install` clean
- [ ] All existing tests pass: `bun run test`

---

### Step 1: Add `aliases` to `CommandMeta`
**Status:** ⬜ Not Started

- [ ] Add `aliases?: readonly string[]` to `CommandMeta` after `hidden`
- [ ] JSDoc covering: behavior, conflict policy, display contract, example
- [ ] Type-level test that `aliases: [...] as const` is accepted
- [ ] Targeted tests + `check:types` clean

---

### Step 2: Resolve aliases in `resolveCommand`
**Status:** ⬜ Not Started

- [ ] Extend lookup to scan sibling `meta.aliases` on miss
- [ ] `commandPath` records canonical name only (with comment)
- [ ] `details.available` includes aliases
- [ ] Decide and document linear scan vs. lazy alias→canonical map
- [ ] Router tests covering: single alias, multiple aliases, nested,
      canonical-path preservation, available list, hidden+alias independence
- [ ] Targeted tests + `check:types` clean

---

### Step 3: Detect alias collisions at registration and validation
**Status:** ⬜ Not Started

- [ ] Extend `.command(name, cb)` and `.command(builder)` with
      collision checks (sibling name, sibling alias, own canonical,
      reverse-order, intra-array dupes)
- [ ] Extend `validateCommandTree` with the same checks for
      plugin-installed subcommands
- [ ] Reject empty / whitespace / leading-`-` aliases
- [ ] Builder tests + validation test for plugin-installed collision
- [ ] Targeted tests + `check:types` clean

---

### Step 4: Render aliases in `helpPlugin`
**Status:** ⬜ Not Started

- [ ] `formatCommandsSection` renders `name (a, b)` inline
- [ ] No empty parens when aliases is undefined/empty
- [ ] Hidden subcommands still skipped (no regression)
- [ ] Column alignment decision documented (overflow over truncation)
- [ ] Regression tests for: aliases rendered, no-alias unchanged, hidden+alias
- [ ] Targeted tests + `check:types` clean

---

### Step 5: Include aliases in `didYouMeanPlugin`
**Status:** ⬜ Not Started

- [ ] Suggestion string is the canonical name even when alias matched
- [ ] Decide: map-back-to-canonical vs filter-aliases (prefer former)
- [ ] Tests for: typo-of-alias suggests canonical; typo-of-canonical
      unchanged; no duplicate suggestions
- [ ] Targeted tests + `check:types` clean

---

### Step 6: Render aliases in `@crustjs/man`
**Status:** ⬜ Not Started

- [ ] `mdoc.ts` SUBCOMMANDS renders `name (a, b)` inline
- [ ] Confirm/note `meta.hidden` handling (no fix here if missing)
- [ ] Column-width calc accounts for alias suffix
- [ ] `mdoc.test.ts` covers alias output
- [ ] Targeted tests + `check:types` clean

---

### Step 7: Documentation
**Status:** ⬜ Not Started

> ⚠️ Hydrate: exact `.mdx` filenames depend on grep results; expand
> after Step 0 records the doc layout

- [ ] API page documents `aliases` with example + conflict policy
- [ ] Guide page adds "Aliases" subsection with worked example
- [ ] Help-rendering format snippet included
- [ ] Conflict policy paragraph + example error message
- [ ] `meta.json` adjustments confirmed (likely none)

---

### Step 8: Testing & Verification
**Status:** ⬜ Not Started

- [ ] `bun run check && bun run check:types && bun run test` clean
- [ ] `bun run build` clean
- [ ] Changesets created and committed:
  - [ ] `@crustjs/core` — minor
  - [ ] `@crustjs/plugins` — minor
  - [ ] `@crustjs/man` — minor

---

### Step 9: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] "Must Update" docs modified
- [ ] "Check If Affected" docs reviewed
- [ ] Discoveries logged: doc files updated, resolver-impl choice,
      did-you-mean strategy, TP-010 cross-talk, changeset bump-level
      decisions

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
| 2026-05-03 | Task staged | PROMPT.md and STATUS.md created |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes (record exact line numbers from Step 0 here)*
