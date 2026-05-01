# Plugins track audit — post-#118

## TP-009: NO_AMENDMENT_NEEDED

**Evidence:**

TP-009 adds two purely-additive fields to `@crustjs/core` public types:
- `choices?: readonly string[]` on `StringFlagDef`, `StringMultiFlagDef`, and `StringArgDef` (lines 131-136 for FlagDef variants, lines 58-64 for StringArgDef in `packages/core/src/types.ts`)
- `hidden?: boolean` on `CommandMeta` (line 592 in `packages/core/src/types.ts`)

Updates `helpPlugin` in `packages/plugins/src/help.ts` to filter `meta.hidden: true` subcommands from the COMMANDS section (line 143-157, specifically the `formatCommandsSection` function which already has the `formatCommandLabel(name, subCommand.meta.aliases)` helper in place from PR #116).

**PR #118 does not affect TP-009's scope:**
- TP-009 touches `@crustjs/core` (types.ts, plugins.src/help.ts), not `@crustjs/validate`
- TP-009 does not use `field()` factory from `@crustjs/validate` (uses core types only)
- TP-009 does not reference the `effect` peer-dependency (note in STATUS.md "help-only effect" is about the behavioral effect of `hidden`, not the npm package)
- The `.gitignore` and `biome.json` changes for `.pi/` artifacts are orthogonal

**TP-009 PROMPT Amendment 1 (2026-05-06) is already integrated:**
- Amendment correctly identifies that PR #116 added `aliases` to `CommandMeta` (line 595-610, pre-verified above)
- Amendment correctly states `formatCommandsSection` calls `formatCommandLabel(name, subCommand.meta.aliases)` (line 150, pre-verified above)
- Amendment recommends placing `hidden` adjacent to `aliases` for grouping — sound guidance
- Amendment recommends composing hidden filtering with alias rendering — already handled by filtering the loop, not the helper

**All PROMPT assumptions remain valid on main post-#118:**
- File paths and line ranges confirmed (FlagDef variants, StringArgDef, CommandMeta, formatCommandsSection)
- No breaking changes to core types or plugin contract
- No undocumented dependencies on validate API

## TP-010: NO_AMENDMENT_NEEDED

**Evidence:**

TP-010 creates a new `completionPlugin` in `@crustjs/plugins` with:
- `packages/plugins/src/completion/spec.ts` — walker output shape
- `packages/plugins/src/completion/walker.ts` — walks `CommandNode` tree using `effectiveFlags` (accessor verified in place), skips `meta.hidden` subcommands (feature from TP-009), captures `choices` from TP-009
- Per-shell templates (`bash.ts`, `zsh.ts`, `fish.ts`) using Cobra-style completions
- Integration in `packages/plugins/src/index.ts` re-export

**PR #118 does not affect TP-010's scope:**
- TP-010 depends on TP-009 for `choices` field and `meta.hidden` field — TP-009 is unaffected by PR #118, so TP-010 is unaffected downstream
- TP-010 walks `CommandNode` using `effectiveFlags` accessor (verified as a public accessor in core/src/node.ts; not the npm package `effect`)
- TP-010 does not touch `@crustjs/validate` or `field()` factory
- TP-010 does not use the `effect` peer-dependency (note: PROMPT mentions Effect as a schema library option for TP-009, but TP-010 only uses `choices` and `meta.hidden` from TP-009, neither of which depend on Effect peer-dep)
- The `.gitignore` and `biome.json` changes are orthogonal

**TP-010 PROMPT Amendment 1 (2026-05-06) is already integrated:**
- Amendment correctly identifies that PR #116 added `aliases: readonly string[]` to `CommandMeta` (verified above)
- Amendment recommends that `CompletionSpec` include aliases as additional completion candidates — sound design choice, no conflict with TP-010's pure-static approach
- Amendment is purely informational; TP-010 can proceed with or without surfacing aliases

**All PROMPT assumptions remain valid on main post-#118:**
- Tier 3 file paths confirmed (CommandNode, FlagDef, ArgDef, plugin contract in plugins.ts)
- No changes to `effectiveFlags` accessor contract
- No undocumented dependencies on validate or Effect

**TP-010 prerequisites (TP-008 and TP-009) unaffected:**
- TP-008 (rename autocomplete → didYouMeanPlugin): verified complete on main (`didYouMeanPlugin` exported from index.ts, `completionPlugin` name is free)
- TP-009 (`choices` and `hidden` fields): no amendments needed per above

## Summary

Both TP-009 and TP-010 are **ready to execute** on the current main branch post-PR #118. PR #118's refactoring of `@crustjs/validate` (locked to 8-function root surface, removal of legacy subpaths, removal of `effect` peer-dep, reshape of `field()` to store factory) does not touch the scope of either task. TP-009 works entirely within `@crustjs/core` and `@crustjs/plugins` types/plugins; TP-010 depends only on TP-009's additive fields (`choices`, `meta.hidden`) and core accessors (`effectiveFlags`), none of which are affected by validate package changes. Both prompts already contain relevant amendments from the supervisor's pre-flight review (Amendment 1, 2026-05-06) addressing the earlier PR #116 alias support, and those amendments are integrated into the file scope and step descriptions. No prompt rewrites or scope adjustments are needed.

## Suggested amendments (if any)

*None. Both TP-009 and TP-010 PMTs are sound and require no amendments post-PR #118.*
