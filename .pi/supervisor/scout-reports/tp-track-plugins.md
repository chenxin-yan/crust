# Staleness Audit — TP-009 & TP-010 PROMPTs vs. Merged TP-016

**Date:** 2026-05-06  
**Scope:** 5 PRs merged on main since TP-009 and TP-010 PROMPTs were authored (TP-006, TP-008, TP-016, TP-007)  
**Critical Finding:** Both PROMPTs were authored **before** PR #116 (TP-016: command aliases) was created and merged. TP-016 added `aliases` to `CommandMeta`, updated help/router/validation, and changed the pattern for collision detection and help rendering — but TP-009 and TP-010 do not reference these changes.

---

## TP-009 Staleness: **4 Issues Identified**

### Issue 1: Line numbers stale (Tier 3 context)
- **PROMPT claim:** "packages/plugins/src/help.ts — `formatCommandsSection` at lines ~121-131 currently iterates `Object.entries(command.subCommands)` with NO filtering."
- **Current reality (main):** TP-016 added a `formatCommandLabel(name, aliases)` helper function and `formatCommandsSection` now calls it on line ~108 (not ~121-131). Function structure has changed.
- **Impact:** Worker will be confused about line numbers and function signature; may not recognize the alias rendering that's already been added.

### Issue 2: Missing knowledge of CommandMeta.aliases field
- **PROMPT context:** Tier 3 says to read "packages/core/src/types.ts — defines `ArgDef`, `FlagDef`, **and `CommandMeta`**" but does NOT mention that `CommandMeta` now (via TP-016) already has an `aliases?: readonly string[]` field with extensive JSDoc describing the collision policy and display contract.
- **TP-009 Step 2 impact:** When adding `hidden?: boolean` to `CommandMeta`, the implementation will land right next to the existing `aliases` field. The implementer should be aware of the existing field and its precedent pattern.

### Issue 3: Missing knowledge of formatCommandLabel helper function
- **PROMPT claim:** Says to update `formatCommandsSection` to filter hidden subcommands by "Filter `Object.entries(command.subCommands)` to skip entries where `subCommand.meta.hidden === true`."
- **Current reality (main):** TP-016 added a `formatCommandLabel(name, aliases): string` helper. `formatCommandsSection` now iterates and calls this helper on each subcommand. The implementation in TP-009 Step 3 must:
  - Preserve the alias rendering already in place (via formatCommandLabel)
  - Apply the hidden filter before calling formatCommandLabel, not after
  - Be aware that formatCommandLabel renders as "name (alias1, alias2)" per TP-016's display contract
- **Example current code:**
  ```ts
  function formatCommandsSection(command: CommandNode): string[] {
    if (Object.keys(command.subCommands).length === 0) return [];
    const lines = [bold(cyan("COMMANDS:"))];
    for (const [name, subCommand] of Object.entries(command.subCommands)) {
      const label = formatCommandLabel(name, subCommand.meta.aliases);
      const rendered = `${padEnd(label, COMMAND_COLUMN_WIDTH, " ")} `;
      lines.push(`  ${rendered}${subCommand.meta.description ?? ""}`.trimEnd());
    }
    return lines;
  }
  ```
- **What TP-009 must NOT do:** Overwrite this function and lose the alias rendering. Must integrate the hidden filter into the existing loop.

### Issue 4: Missing knowledge of alias validation pattern precedent (Tier 3 context)
- **PROMPT says:** For Step 0 preflight, "Confirm via grep where `CommandMeta` is **defined**" but doesn't mention that `packages/core/src/validation.ts` now has `validateAliasString(alias, canonicalName, subjectLabel)` and `validateIncomingAliases(name, aliases, subjectLabel)` functions (added by TP-016) that establish a pattern for how to validate collisions.
- **Impact:** While TP-009 does not add collision detection to `hidden` (it's a simple boolean), understanding the alias validation pattern helps the implementer write parallel tests. If future tasks add collision detection to `hidden`, they will follow the established pattern.

---

## TP-010 Staleness: **3 Issues Identified**

### Issue 1: Missing knowledge of alias-aware didYouMeanPlugin
- **PROMPT says:** In Tier 3 context, "packages/plugins/src/did-you-mean.ts — `didYouMeanPlugin`'s middleware (around lines 73–120) consumes `details.available` from the routing error; that list must include aliases."
- **Current reality (main):** TP-016 **completely refactored** did-you-mean's `findSuggestions` function:
  - Old signature: `findSuggestions(input: string, candidates: string[]): string[]`
  - **New signature:** `findSuggestions(input: string, subCommands: Record<string, CommandNode>): string[]`
  - Now iterates both canonical names AND aliases via `node.meta.aliases ?? []`
  - Maps alias matches back to canonical names (so suggestions are always canonical)
  - JSDoc explicitly explains the alias-aware logic and mapping behavior
- **TP-010 impact:** When the completion plugin calls help functions or integrates with did-you-mean, it will be operating against a **different API** than the PROMPT describes. The walker will need to understand that:
  - `didYouMeanPlugin` no longer receives a flat `details.available` string array
  - It receives the full `details.parentCommand` (a `CommandNode`) and extracts both canonical names and aliases itself
  - Alias suggestions are automatically mapped to canonical names

### Issue 2: Missing knowledge of router's alias resolution behavior
- **PROMPT context:** Says to read "packages/core/src/router.ts — `resolveCommand` is the routing function being extended" but doesn't mention:
  - TP-016 added a `findAliasMatch(subCommands, candidate)` function to handle alias resolution
  - `commandPath` now **always records canonical names**, never aliases (even if the user typed an alias)
  - Aliases are checked after canonical names via a sibling scan
  - This behavior affects how the completion plugin's walker should record command paths (always use canonical names)
- **TP-010 impact (low):** The PROMPT correctly says to walk the live `CommandNode` tree and emit canonical names. The router changes don't break this, but the implementer should know:
  - Canonical names are the ground truth for routing and help
  - If the walker includes aliases in the CompletionSpec, they should be labeled as such
  - The router's canonical-first behavior is intentional and the completion plugin should mirror it

### Issue 3: Missing knowledge that CommandMeta now has aliases field
- **PROMPT says:** In Tier 3 context, read "packages/core/src/types.ts — `FlagDef`, `ArgDef`, the `choices` field landed in TP-009" (assuming TP-009 has landed).
- **Current reality (main):** `types.ts` already has an `aliases?: readonly string[]` field on `CommandMeta` (from TP-016) with detailed JSDoc. The walker needs to:
  - Be aware that `CommandNode.meta.aliases` exists and may be populated
  - Decide whether aliases should be included in the `CompletionSpec` (the PROMPT doesn't explicitly say, but TP-016's pattern suggests they should be available to completion templates)
  - Understand the alias-to-canonical mapping that the router enforces
- **Step 1 (Walker) impact:** The Tier 3 context doesn't list the alias field, so the implementer may miss it during the walk. Should add `meta.aliases` to the CompletionSpec if capturing metadata is part of the spec design.

---

## Verification Summary

### Files Changed by TP-016 (Not Reflected in TP-009/TP-010 PROMPTs)

| File | TP-016 Change | TP-009 Awareness | TP-010 Awareness |
|------|---------------|-----------------|----|
| `packages/core/src/types.ts` | Added `aliases?: readonly string[]` to `CommandMeta` | ❌ MISSING from Tier 3 context | ❌ MISSING from Tier 3 context |
| `packages/core/src/validation.ts` | Added `validateAliasString`, `validateIncomingAliases`, updated `validateCommandTree` | ⚠️ Low impact (TP-009 doesn't add collision detection) | ❌ MISSING; relevant if completion spec validates aliases |
| `packages/core/src/router.ts` | Added `findAliasMatch`, made resolution alias-aware | ⚠️ Low impact (TP-009 doesn't touch routing) | ⚠️ Should be aware for walker correctness, but not blocking |
| `packages/plugins/src/help.ts` | Added `formatCommandLabel(name, aliases)`, updated `formatCommandsSection` to call it | ❌ **CRITICAL** — lines wrong, function signature changed | ⚠️ Low impact (TP-010 doesn't re-export help.ts) |
| `packages/plugins/src/did-you-mean.ts` | Refactored `findSuggestions` signature and alias-aware logic | ⚠️ Low impact (TP-009 doesn't touch did-you-mean) | ❌ **CRITICAL** — function signature completely changed |

---

## Risk Assessment

### TP-009 Risk Level: **MEDIUM** → Implementer May Miss Alias Integration

**Why:** Step 3 (update `helpPlugin`) directly touches `formatCommandsSection`, which has been refactored by TP-016. If the implementer naively overwrites the function without preserving the `formatCommandLabel` call, **alias rendering will be lost**. This is a silent regression — the feature would work, but help output for commands with aliases would degrade.

**Mitigation:** Implementer should:
1. Read current `formatCommandsSection` on main (not the stale line numbers in PROMPT)
2. Recognize `formatCommandLabel` is already in place
3. Integrate the `hidden` filter into the existing loop structure
4. Add tests that verify both hidden filtering AND alias rendering work together

### TP-010 Risk Level: **LOW** → Completeness Issue, Not Blocking

**Why:** TP-010 doesn't directly depend on did-you-mean's signature or help.ts internals. The PROMPT correctly says to walk the tree and emit static scripts. However, the implementer won't understand:
- Why the did-you-mean plugin's `findSuggestions` signature is different from what the PROMPT describes
- That `CommandMeta.aliases` exists and might be relevant to completion behavior

**Mitigation:** Implementer should:
1. Read current did-you-mean.ts and router.ts on main (they're in Tier 3 context already)
2. Recognize the alias-aware changes
3. If adding aliases to the completion spec, understand how to map them correctly

---

## Specific Stale References in PROMPTs

### TP-009 PROMPT

**Tier 3 Line Number Staleness:**
```
- `packages/plugins/src/help.ts` — `formatCommandsSection` at lines ~121-131 currently iterates `Object.entries(command.subCommands)` with NO filtering. This is the function being updated.
```
**Current Line:** formatCommandsSection is ~107-117 on main, calls formatCommandLabel (which doesn't exist in PROMPT text).

**Step 3 Description Staleness:**
```
- [ ] In `packages/plugins/src/help.ts`, update `formatCommandsSection`:
  - Filter `Object.entries(command.subCommands)` to skip entries where `subCommand.meta.hidden === true`
```
**Reality:** Must preserve the existing `formatCommandLabel(name, subCommand.meta.aliases)` call while adding the hidden filter.

---

### TP-010 PROMPT

**Tier 3 Function Signature Staleness:**
```
- `packages/plugins/src/did-you-mean.ts` — `didYouMeanPlugin`'s middleware (around lines 73–120) consumes `details.available` from the routing error; that list must include aliases.
```
**Reality:** `findSuggestions` signature changed; the function now takes `subCommands: Record<string, CommandNode>` instead of a string array, and walks aliases internally.

**Missing Context:**
No mention in Tier 3 that `CommandMeta` now has `aliases?: readonly string[]` (from TP-016), which affects the walker's output spec design.

---

## Conclusion

### TP-009 Staleness: **4 Issues**
1. Line numbers stale for formatCommandsSection
2. Missing knowledge of CommandMeta.aliases
3. Missing knowledge of formatCommandLabel helper
4. Missing knowledge of alias validation pattern precedent (lower impact)

### TP-010 Staleness: **3 Issues**
1. **Critical:** didYouMeanPlugin's `findSuggestions` signature completely changed by TP-016
2. **Medium:** Missing knowledge of router's alias resolution behavior
3. **Low:** Missing knowledge that CommandMeta.aliases exists

### Recommendation for Implementer

- **TP-009:** Before Step 3, read current formatCommandsSection on main and understand formatCommandLabel. Integrate hidden filtering without losing alias rendering.
- **TP-010:** Before Step 1, read current router.ts and did-you-mean.ts on main. Understand that aliases are now a first-class routing concern and that did-you-mean handles alias-aware suggestions.
- **Both:** When reading the Tier 3 files in packages/core/src/types.ts, note that CommandMeta now has an aliases field with extensive JSDoc describing conflict policy and display contracts — use this as a pattern reference.
