# TP-010: Add `completionPlugin` (pure-static, bash + zsh + fish, print + `--output-dir`) — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-04-29
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** L

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it — aim for
> 2-5 outcome-level items per step, not exhaustive implementation scripts.

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] TP-008 merged: `didYouMeanPlugin` exists, `completionPlugin` name is free
- [ ] TP-009 merged: `choices` field on `FlagDef`/`ArgDef`, `meta.hidden` on `CommandNode`
- [ ] All listed Tier 3 source files and `/tmp/crust-completion-{research,verification}/*` artifacts exist on disk
- [ ] `bun install` clean and existing `@crustjs/plugins` tests pass

---

### Step 1: Walker + spec types
**Status:** ⬜ Not Started

> Plan + code review required (override).

- [ ] `CompletionSpec` shape defined in `spec.ts`
- [ ] Walker traverses `CommandNode` using `effectiveFlags`, skips `meta.hidden`, captures `choices`, strips ANSI from descriptions
- [ ] `walker.test.ts` covers: empty tree, flat commands, nested subcommands, inherited flags, hidden filtering, choices captured, ANSI stripped
- [ ] Targeted tests green

---

### Step 2: Bash template
**Status:** ⬜ Not Started

> ⚠️ Hydrate: Expand to track concrete subprocess scenarios (top-level subcommand, nested subcommand, flag with choices) once `renderBash` output stabilizes.

- [ ] `renderBash(spec, binName, version)` implemented with Cobra-style init shim and `complete -F` registration
- [ ] Header comment with bin name + version + regenerate hint emitted as first line
- [ ] `bash.test.ts` covers one snapshot golden + behavioral subprocess tests asserting `COMPREPLY` for ≥3 scenarios
- [ ] Targeted tests green

---

### Step 3: Zsh template
**Status:** ⬜ Not Started

> ⚠️ Hydrate: Expand to track the actual `_arguments -C` / `->state` shape after the first generated script compiles cleanly under `zsh -n`.

- [ ] `renderZsh(spec, binName, version)` implemented with `#compdef` first line, `_arguments -C`, `->state` subcommand routing, and choices via `(opt1 opt2 …)`
- [ ] `zsh.test.ts` covers snapshot + behavioral test under `zsh -c` (skip-with-note if zsh missing)
- [ ] Targeted tests green

---

### Step 4: Fish template
**Status:** ⬜ Not Started

> ⚠️ Hydrate: Expand to track the chained `-n '__fish_seen_subcommand_from …'` predicates after the first generated script parses under `fish -n`.

- [ ] `renderFish(spec, binName, version)` implemented with declarative `complete -c` rules, chained `-n` predicates, and choices via `-x -a '…'`
- [ ] `fish.test.ts` covers snapshot + behavioral test under `fish -c` (skip-with-note if fish missing)
- [ ] Targeted tests green

---

### Step 5: Plugin factory + integration tests
**Status:** ⬜ Not Started

- [ ] `completionPlugin(options?)` registers `completion <shell>` subcommand with `--output-dir` flag and walks lazily inside `run()`
- [ ] Stdout path prints to console; `--output-dir` writes correctly named files (`<bin>`, `_<bin>`, `<bin>.fish`)
- [ ] `index.ts` re-exports `completionPlugin` and `CompletionPluginOptions`
- [ ] `index.test.ts` exercises print path and `--output-dir` path end-to-end
- [ ] Targeted tests green

---

### Step 6: Documentation
**Status:** ⬜ Not Started

> ⚠️ Hydrate: Confirm exact MDX paths and `meta.json`/sidebar conventions in `apps/docs/content/docs/modules/plugins/` before writing.

- [ ] `completion.mdx` covers usage, per-shell install, packaging recipes (Homebrew/Nix/AUR), nixpkgs cross-compile note, drift handling, v1 limitations, design-notes section
- [ ] `packages/plugins/README.md` plugin table includes `completionPlugin` row
- [ ] Plugins guide (if present) cross-links to the new module page

---

### Step 7: Testing & Verification
**Status:** ⬜ Not Started

- [ ] FULL test suite passing (`bun run check && bun run check:types && bun run test`)
- [ ] Build passes (`bun run build`)
- [ ] Manual smoke test against a tiny scaffolded CLI (print path + `--output-dir` path)
- [ ] Changeset added: `@crustjs/plugins` minor — add `completionPlugin` for shell tab-completion

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
