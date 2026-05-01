# Staleness Audit — Skills Track (TP-003, TP-004, TP-005)

**Audit Date:** 2026-05-06  
**Context:** 5 PRs/commits merged on main since PROMPT authoring:
- PR #114 (TP-006) — `agents` optional on @crustjs/skills entrypoints
- PR #115 (TP-008) — `autoCompletePlugin` → `didYouMeanPlugin` rename
- PR #116 (TP-016) — `aliases` added to CommandMeta
- PR #113 (TP-007) — @crustjs/validate refactored to Standard Schema
- Commit 09e239c — latent skills test fixes

---

## TP-003 staleness: **NONE**

All referenced APIs, file paths, and contexts are correct and in the expected state.

### Verified:

1. **API References** — All three entry points (`generateSkill`, `uninstallSkill`, `skillStatus`) exist with correct signatures:
   - `packages/skills/src/generate.ts` lines 174, 367, 464 ✓
   - All accept optional `agents` parameter per PR #114 (aligns with PROMPT assumptions) ✓
   - Helper functions `resolveGenerateAgents()` and `resolveAllAgentTargets()` exist at lines 63–84, 86 ✓
   - **Amendment 1 already documents:** PROMPT references `resolveAgents()` but the actual function is `resolveGenerateAgents()` — no action needed

2. **File Scope** — All referenced files exist and are unmodified in relevant parts:
   - `packages/skills/src/version.ts` (81 lines) — provides `readInstalledVersion()`, `checkVersion()` ✓
   - `packages/skills/src/errors.ts` — `SkillConflictError` exists with `.details` field; no `kindMismatch` yet (expected—TP-003 adds it) ✓
   - `packages/skills/src/types.ts` — `GenerateOptions`, `UninstallOptions`, `StatusOptions` all with optional `agents` ✓
   - `packages/skills/src/agents.ts` — exports `resolveAgentPath`, `resolveCanonicalSkillPath`, `ALL_AGENTS`, etc. ✓
   - `packages/skills/src/render.ts` — SKILL.md frontmatter rendering with `name:` field intact ✓
   - `packages/skills/src/index.ts` — exports `generateSkill`, `uninstallSkill`, `skillStatus` ✓

3. **Reference Implementation** — Source-dir resolution helpers for TP-003 to mirror:
   - `packages/create/src/scaffold.ts` — `findNearestPackageRoot()` at line 84, `resolveTemplateDir()` at line 108 ✓
   - Both functions are private (as PROMPT expects to copy them initially) ✓

4. **Unaffected by Merged PRs:**
   - PR #114 (agents optional) **reinforces** TP-003's design; no conflict ✓
   - PR #115, #116, #113, Commit 09e239c are in unrelated packages ✓

5. **Not Yet Implemented (expected):**
   - No `bundle.ts` file (TP-003 will create)
   - No `SkillKind` type (TP-003 Step 2 adds)
   - No `installSkillBundle` export (TP-003 Step 5 adds)

---

## TP-004 staleness: **NONE**

All dependencies and referenced APIs are in the expected state.

### Verified:

1. **Dependency Met** — TP-003 is a prerequisite:
   - PROMPT correctly expects `installSkillBundle` to exist before TP-004 starts ✓
   - PROMPT correctly expects TP-003 to handle bundle file loading and safety checks ✓

2. **Plugin API** — Current `SkillPluginOptions` structure:
   - `packages/skills/src/types.ts` line 481 — exists, contains `version`, `defaultScope`, `installMode`, `autoUpdate`, etc. ✓
   - No `customSkills` field yet (expected—TP-004 adds it) ✓
   - `skillPlugin()` in `packages/skills/src/plugin.ts` exists and handles generation and interactive commands ✓

3. **Helper Functions Available** — For TP-004 to call:
   - `generateSkill()`, `skillStatus()`, `uninstallSkill()` all importable and callable ✓
   - `formatAgentLabels()`, `formatInstallOutput()` helper patterns in plugin.ts ✓
   - `resolveEffectiveScope()`, agent detection helpers available ✓

4. **Not Yet Implemented (expected):**
   - No `customSkills` option on `SkillPluginOptions` (TP-004 Step 2 adds)
   - No `CustomSkillConfig` type (TP-004 Step 2 adds)

---

## TP-005 staleness: **NONE**

All package scaffolding references and migration targets are correct.

### Verified:

1. **Dependencies Met** — TP-003 and TP-004 are prerequisites:
   - PROMPT correctly expects `packages/skills/src/bundle.ts` to exist (created by TP-003) ✓
   - PROMPT correctly expects `packages/create/src/scaffold.ts` as the reference implementation ✓

2. **Reference Implementation** — Source-dir resolution to extract:
   - `packages/create/src/scaffold.ts` lines 84–108:
     - `findNearestPackageRoot(startPath: string): string | null` at line 84 ✓
     - `resolveTemplateDir(template: string | URL): string` at line 108 ✓
   - Both are private functions (PROMPT correctly expects to copy them) ✓
   - Both handle three modes: `URL` (file: protocol), absolute string, relative string (resolved from `process.argv[1]`) ✓

3. **Scaffold Package** — Template for new `@crustjs/utils`:
   - `packages/create/package.json` — exists with workspace structure ✓
   - `packages/create/tsconfig.json` — extends `@crustjs/config/tsconfig.base.json` ✓
   - `packages/create/bunup.config.ts` — bundle configuration to mirror ✓

4. **Not Yet Implemented (expected):**
   - `packages/utils/` directory does not exist (TP-005 Step 2 creates it)
   - No `@crustjs/utils` in any package's dependencies yet ✓

5. **Unaffected by Merged PRs:**
   - No changes to `@crustjs/create` API (only internal) ✓
   - PR #113 refactored `@crustjs/validate`, not used by scaffold.ts ✓

---

## Summary

**No staleness detected.** All three PROMPT files are accurate against the current codebase:

- API signatures match expectations (including PR #114's agents-optional change)
- File paths and line numbers are correct
- Helper functions exist and are importable
- No unanticipated API changes from merged PRs affect scope
- Dependency chain (TP-003 → TP-004 → TP-005) is sound

**Amendment 1 (resolveAgents → resolveGenerateAgents)** is already documented in TP-003 PROMPT and requires no further action.

Workers can proceed with execution as planned.
