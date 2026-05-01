# Skills track audit — post-#118

## TP-003: NO_AMENDMENT_NEEDED

**Evidence:**
- PROMPT.md contains **zero references** to deleted validate APIs (`parsePromptValue`, `promptValidator`, `fieldSync`, `/zod`, `/effect`, `/standard` subpaths)
- PROMPT.md contains **zero references** to `@crustjs/validate` package or `field()` function
- PROMPT.md contains **zero references** to `effect` peer-dependency
- The `packages/skills/src/` package.json (lines 1-34) has **no dependency on `@crustjs/validate`** — only `@crustjs/progress`, `@crustjs/prompts`, `@crustjs/style` in dependencies
- All "Context to Read First" files exist and are current: `packages/skills/src/generate.ts`, `types.ts`, `index.ts`, `render.ts`, `errors.ts`, `agents.ts` show no validate references
- Existing Amendment 1 (2026-05-03) addresses `resolveAgents` naming, not validate
- TP-003 is a **new API** (`installSkillBundle`) that doesn't exist yet — it builds on top of existing `generateSkill`/`uninstallSkill`/`skillStatus` primitives which have no validate dependency

## TP-004: NO_AMENDMENT_NEEDED

**Evidence:**
- PROMPT.md contains **zero references** to deleted validate APIs or `@crustjs/validate`
- TP-004 extends `skillPlugin` with `customSkills` option — purely a plugin shape extension
- Depends on TP-003 *functionally* (needs `installSkillBundle()` to wrap), not on validate changes
- All referenced files (`plugin.ts`, `plugin.test.ts`, `types.ts`, `generate.ts`) have **no validate dependency**
- The sequential multiselect UX and validation rules (Step 1) are orthogonal to validate API changes

## TP-005: NO_AMENDMENT_NEEDED

**Evidence:**
- PROMPT.md contains **zero references** to `@crustjs/validate` or any validate API
- TP-005 is pure package scaffolding + dedup of `resolveSourceDir` between `@crustjs/create` and `@crustjs/skills`
- Reference implementation in `packages/create/src/scaffold.ts` (lines 84 `findNearestPackageRoot`, line 108 `resolveTemplateDir`) has **no validate dependency**
- The dedup target in `packages/skills/src/bundle.ts` (created by TP-003) will be a new private resolver using the same three-mode pattern — validate-independent
- CONTEXT.md tech-debt entries (Step 7) mention `readPackageJson` and `parseSemver` as future candidates, but these are deferred and orthogonal to PR #118

---

## Summary

PR #118 made breaking changes to `@crustjs/validate` (deleted subpaths, removed legacy helpers, reshaped `field()`), but **none of the three skills-track tasks depend on validate**. The `@crustjs/skills` package has **zero dependency** on `@crustjs/validate` today. TP-003 introduces a new API (`installSkillBundle`) that builds on existing skill-generation primitives which are already validate-free. TP-004 extends the plugin shape to manage multiple skills using TP-003's new API. TP-005 dedupes path-resolution helpers between `create` and `skills` — both packages are validate-independent. All task PROPMTs reference only skills-package internals and the canonical `resolveTemplateDir` precedent in create, neither of which was touched by PR #118.

---

## Suggested amendments (if any)

*None required.* All three task PROMPTs remain current and require no adjustments for post-PR #118 execution.
