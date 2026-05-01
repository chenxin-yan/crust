# Task: TP-008 — Rename `autoCompletePlugin` to `didYouMeanPlugin`

**Created:** 2026-04-29
**Size:** S

## Review Level: 1 (Plan Only)

**Assessment:** Pure user-facing rename in a single published package with a
deprecation alias kept until 1.0.0. Behavior is unchanged. Plan review locks
the alias shape, JSDoc wording, and changeset bump category before the rename
is propagated through tests, README, docs, and the changeset.
**Score:** 2/8 — Blast radius: 1, Pattern novelty: 0, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-008-rename-autocomplete-to-did-you-mean/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (created by the orchestrator runtime)
└── .DONE       ← Created when complete
```

## Mission

The current `autoCompletePlugin` in `@crustjs/plugins` is misnamed: it
implements "did you mean?" command suggestion via Levenshtein matching, not
shell tab-completion as the name implies. Before TP-010 introduces a real
shell-completion plugin, rename the existing plugin to `didYouMeanPlugin` to
free the "completion" namespace and accurately describe its behavior. Keep
`autoCompletePlugin` (and its options type) as a silent deprecated alias —
JSDoc `@deprecated` only, no runtime `console.warn` — so existing users are
not broken. The alias is removed in 1.0.0. Behavior is unchanged: this is a
pure rename plus alias.

## Dependencies

- **None**

## Context to Read First

> Only list docs the worker actually needs. Less is better.

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `packages/plugins/src/autocomplete.ts` — the file being renamed; confirms current export names and behavior
- `packages/plugins/src/index.ts` — current public exports; needs new exports + deprecated aliases
- `packages/plugins/src/plugins.test.ts` — existing tests that reference `autoCompletePlugin`/`AutoCompletePluginOptions`
- `packages/plugins/README.md` — plugin table entry to update
- `apps/docs/content/docs/modules/plugins/autocomplete.mdx` — doc page being renamed

## Environment

- **Workspace:** `packages/plugins/` (primary), `apps/docs/`, `.changeset/`
- **Services required:** None

## File Scope

- `packages/plugins/src/autocomplete.ts` (delete via `git mv`)
- `packages/plugins/src/did-you-mean.ts` (new — content moved from `autocomplete.ts` with renames)
- `packages/plugins/src/index.ts` (modified — new exports + deprecated aliases)
- `packages/plugins/src/plugins.test.ts` (modified — references renamed)
- `packages/plugins/src/did-you-mean.test.ts` (new — alias-equivalence + smoke test)
- `packages/plugins/README.md` (modified — plugin table entry)
- `apps/docs/content/docs/modules/plugins/autocomplete.mdx` (delete via `git mv`)
- `apps/docs/content/docs/modules/plugins/did-you-mean.mdx` (new — content moved + migration note)
- `.changeset/*.md` (new — minor bump for `@crustjs/plugins`)

> Note: `apps/docs/content/docs/modules/plugins/meta.json` uses a `"pages"`
> wildcard, so the renamed `.mdx` is auto-included — do not edit it.

## Steps

> **Hydration:** STATUS.md tracks outcomes, not individual code changes. Workers
> expand steps when runtime discoveries warrant it. See task-worker agent for rules.

### Step 0: Preflight

- [ ] All listed files in "File Scope" exist on disk (or are confirmed as new)
- [ ] Dependencies satisfied (none)
- [ ] Existing plugins-package tests pass before any changes: `cd packages/plugins && bun test`
- [ ] Grep the repo for `autoCompletePlugin` and `AutoCompletePluginOptions`; record every hit in STATUS.md Notes so nothing is missed during the rename

### Step 1: Rename source file and exports

- [ ] `git mv packages/plugins/src/autocomplete.ts packages/plugins/src/did-you-mean.ts`
- [ ] Inside `did-you-mean.ts`: rename function `autoCompletePlugin` → `didYouMeanPlugin`, type `AutoCompletePluginOptions` → `DidYouMeanPluginOptions`, and update internal comments / log strings that say "autocomplete" to reflect the new name
- [ ] Update `packages/plugins/src/index.ts`:
  - Replace the existing `autocomplete` re-exports with `didYouMeanPlugin` and `DidYouMeanPluginOptions` from `./did-you-mean`
  - Add deprecated value alias: `/** @deprecated Use \`didYouMeanPlugin\` instead. Will be removed in 1.0.0. */ export const autoCompletePlugin = didYouMeanPlugin;`
  - Add deprecated type alias: `/** @deprecated Use \`DidYouMeanPluginOptions\` instead. Will be removed in 1.0.0. */ export type AutoCompletePluginOptions = DidYouMeanPluginOptions;`
- [ ] Run targeted tests: `cd packages/plugins && bun test`

**Artifacts:**
- `packages/plugins/src/did-you-mean.ts` (new — moved + renamed)
- `packages/plugins/src/autocomplete.ts` (deleted)
- `packages/plugins/src/index.ts` (modified)

### Step 2: Update tests, README, and docs

- [ ] Update `packages/plugins/src/plugins.test.ts`: replace `autoCompletePlugin` / `AutoCompletePluginOptions` references with the new names
- [ ] Create `packages/plugins/src/did-you-mean.test.ts` with at least two tests:
  - `didYouMeanPlugin()` produces a working plugin (smoke test of the suggestion behavior)
  - The deprecated `autoCompletePlugin` export is the **same reference** as `didYouMeanPlugin` (`expect(autoCompletePlugin).toBe(didYouMeanPlugin)`)
- [ ] Update `packages/plugins/README.md`: change the plugin-table entry from "autocomplete" to "did-you-mean" with a brief description matching the new name
- [ ] `git mv apps/docs/content/docs/modules/plugins/autocomplete.mdx apps/docs/content/docs/modules/plugins/did-you-mean.mdx`
- [ ] Update the renamed `.mdx`: title, frontmatter (`title`, `description`), and add a short top-of-page **"Migration from `autoCompletePlugin`"** section explaining the rename and that the old export remains as a deprecated alias until 1.0.0
- [ ] Run targeted tests: `cd packages/plugins && bun test`

**Artifacts:**
- `packages/plugins/src/plugins.test.ts` (modified)
- `packages/plugins/src/did-you-mean.test.ts` (new)
- `packages/plugins/README.md` (modified)
- `apps/docs/content/docs/modules/plugins/did-you-mean.mdx` (new — moved + updated)
- `apps/docs/content/docs/modules/plugins/autocomplete.mdx` (deleted)

### Step 3: Add changeset and run full verification

- [ ] Create a changeset in `.changeset/` (use `bunx changeset` or hand-write) with:
  - `@crustjs/plugins`: **minor**
  - Body: "Renamed `autoCompletePlugin` to `didYouMeanPlugin`. The old export remains as a deprecated alias and will be removed in 1.0.0. The plugin's behavior is unchanged — it provides 'did you mean?' command suggestion via Levenshtein matching, NOT shell tab completion."
- [ ] Run FULL test suite: `bun run check && bun run check:types && bun run test`
- [ ] Run build: `bun run build`
- [ ] Fix any failures

### Step 4: Documentation & Delivery

- [ ] Verify the rename is consistent across `packages/plugins/README.md`, the renamed `.mdx`, and source code (one final grep for stray `autoCompletePlugin`/`AutoCompletePluginOptions` references — only the deprecation aliases in `index.ts` and the alias-equivalence test should remain)
- [ ] "Must Update" docs modified
- [ ] "Check If Affected" docs reviewed
- [ ] Discoveries logged in STATUS.md

## Documentation Requirements

**Must Update:**
- `packages/plugins/README.md` — plugin-table entry renamed to "did-you-mean" with updated description
- `apps/docs/content/docs/modules/plugins/did-you-mean.mdx` — renamed page with updated title/frontmatter and a "Migration from `autoCompletePlugin`" section

**Check If Affected:**
- Any other `apps/docs/content/docs/**` page that mentions `autoCompletePlugin` by name — update import/example or add a one-line migration note
- `packages/plugins/README.md` examples and code snippets — verify imports use the new name

## Completion Criteria

- [ ] All steps complete
- [ ] All tests passing (full suite green)
- [ ] Build passes
- [ ] Changeset added
- [ ] Documentation updated
- [ ] Deprecation aliases (`autoCompletePlugin`, `AutoCompletePluginOptions`) still exported from `@crustjs/plugins` with `@deprecated` JSDoc

## Git Commit Convention

Commits happen at **step boundaries** (not after every checkbox). All commits
for this task MUST include the task ID for traceability:

- **Step completion:** `feat(TP-008): complete Step N — description`
- **Bug fixes:** `fix(TP-008): description`
- **Tests:** `test(TP-008): description`
- **Hydration:** `hydrate: TP-008 expand Step N checkboxes`

## Do NOT

- Add a runtime `console.warn` to the deprecation alias — JSDoc `@deprecated` only (a runtime warning would pollute every user command)
- Change the plugin's behavior — this is a pure rename; semantics must be identical
- Touch any other plugins
- Modify `apps/docs/content/docs/modules/plugins/meta.json` (wildcard auto-includes the renamed page)
- Manually edit `CHANGELOG.md` — use a changeset
- Expand task scope — add tech debt to `taskplane-tasks/CONTEXT.md` instead
- Skip tests
- Commit without the `TP-008` prefix in the commit message

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution.
     Format:
     ### Amendment N — YYYY-MM-DD HH:MM
     **Issue:** [what was wrong]
     **Resolution:** [what was changed] -->

### Amendment 1 — 2026-05-03 (supervisor pre-flight)
**Issue:** The 'File Scope' / 'Context to Read First' sections list the
`@crustjs/plugins` package files but omit two consumers of
`autoCompletePlugin` outside that package:
  - `packages/crust/src/cli.ts` (imports + uses `autoCompletePlugin`)
  - `packages/crust/src/cli.test.ts` (imports + uses `autoCompletePlugin`)
**Resolution:** Worker's Step 0 grep (`rg "autoCompletePlugin\|AutoCompletePluginOptions" --type ts`)
will catch both files. Update them as part of the rename + alias work
so `@crustjs/crust` continues to type-check. The deprecated alias
(`autoCompletePlugin`) keeps these consumers working without code
changes, so this is a docs-only correction — the worker may keep using
the alias in `crust/src/cli.ts` if preferred (alias removal is
scheduled for 1.0.0 per PROMPT).
**Source:** Scout verification 2026-05-03, `.pi/supervisor/scout-reports/TP-008.md`.
