# TP-009: `choices` on `FlagDef`/`ArgDef` and `hidden` on `CommandMeta` — Status

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

- [ ] Required files exist (`packages/core/src/types.ts`, `packages/core/src/node.ts`, `packages/plugins/src/help.ts`)
- [ ] `CommandMeta`, `FlagDef`, `ArgDef` definition sites and line numbers recorded in Notes
- [ ] `formatCommandsSection` confirmed unfiltered before edit
- [ ] `bun install` clean
- [ ] Existing test suite passes pre-change

---

### Step 1: Add `choices` to `FlagDef` and `ArgDef`
**Status:** ⬜ Not Started

- [ ] `choices?: readonly string[]` added to `StringFlagDef`, `StringMultiFlagDef`, and `StringArgDef` only
- [ ] JSDoc clarifies "tooling hint, not enforced at parse time" with a one-line example
- [ ] Type-level tests cover positive (string flag, string multi-flag, string arg) and negative (`@ts-expect-error` on boolean/number flag and arg) cases
- [ ] `cd packages/core && bun test` passes
- [ ] `cd packages/core && bun run check:types` clean

---

### Step 2: Add `hidden` to `CommandMeta`
**Status:** ⬜ Not Started

- [ ] `hidden?: boolean` added to `CommandMeta` at its actual definition site
- [ ] JSDoc clarifies help-only effect; routing/invocation unaffected
- [ ] Type-level test confirms `meta.hidden: true` is accepted
- [ ] `cd packages/core && bun test` passes
- [ ] `cd packages/core && bun run check:types` clean

---

### Step 3: Update `helpPlugin` to filter hidden commands
**Status:** ⬜ Not Started

- [ ] `formatCommandsSection` filters `subCommand.meta.hidden === true`
- [ ] Empty-after-filter case returns `[]` (no orphan COMMANDS heading)
- [ ] Regression test in `plugins.test.ts` asserts visible subcommand renders and hidden one is omitted from COMMANDS section
- [ ] Hidden subcommand confirmed still resolvable by direct invocation (test added or finding recorded in Discoveries)
- [ ] `cd packages/plugins && bun test` passes
- [ ] `cd packages/plugins && bun run check:types` clean

---

### Step 4: Documentation
**Status:** ⬜ Not Started

> ⚠️ Hydrate: Worker greps `apps/docs/content/docs/` for `FlagDef`, `ArgDef`,
> `CommandMeta`, `subCommands`, and `meta:` examples upon entering this step,
> then expands the checkboxes below to the actual files found before editing.

- [ ] API doc page(s) for `FlagDef` / `ArgDef` / `CommandMeta` identified (grep results recorded in Notes)
- [ ] `choices` documented with example and "completion-only, not enforced" caveat
- [ ] `hidden` documented with example and routing-unaffected note
- [ ] Affected guide page(s) (flags / arguments / subcommands) updated with brief mention + link to API page (or skipped with rationale recorded)
- [ ] `meta.json` files inspected; updated only if structure changed

---

### Step 5: Testing & Verification
**Status:** ⬜ Not Started

- [ ] FULL test suite passing: `bun run test`
- [ ] Lint passing: `bun run check`
- [ ] Type-check passing: `bun run check:types`
- [ ] Build passing: `bun run build`
- [ ] `@crustjs/core` minor changeset created (purely additive, completion-only, hidden affects help only)
- [ ] `@crustjs/plugins` minor (or patch) changeset created; bump-level decision recorded in Discoveries with rationale matched against recent `.changeset/*.md` precedent

---

### Step 6: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] "Must Update" docs modified (API page + both changesets)
- [ ] "Check If Affected" docs reviewed (guide pages, modules pages, package READMEs)
- [ ] Discoveries logged: doc files updated, any unexpected `choices`/`hidden` consumers, plugins-changeset bump-level decision

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
| 2026-04-29 | Task staged | PROMPT.md and STATUS.md created. Two purely-additive fields on `@crustjs/core` public API: `choices?: readonly string[]` on string-typed `FlagDef`/`ArgDef` variants (completion-only, not enforced at parse time), and `hidden?: boolean` on `CommandMeta` (filters help output via `helpPlugin.formatCommandsSection`; routing unaffected). Foundation for TP-010 shell-completion plugin. |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes — Step 0 grep results (definition sites + line numbers for `FlagDef`, `ArgDef`, `CommandMeta`), Step 4 doc-file hydration (which `.mdx` pages were identified), and Step 5 plugins-changeset bump-level decision will be recorded here.*
