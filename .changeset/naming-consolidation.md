---
"@crustjs/extensions": minor
"@crustjs/skills": minor
"@crustjs/testing": minor
---

Consolidate public naming conventions (breaking renames):

- `@crustjs/extensions`: `VersionExtensionOptions` → `VersionOptions` (matches `CompletionOptions`, `DidYouMeanOptions`, `UpdateNotifierOptions`).
- `@crustjs/skills`: `skillStatus()` → `getSkillStatus()`; type renames `GenerateOptions`/`GenerateResult` → `GenerateSkillOptions`/`GenerateSkillResult`, `UninstallOptions`/`UninstallResult` → `UninstallSkillOptions`/`UninstallSkillResult`, `StatusOptions`/`StatusResult` → `SkillStatusOptions`/`SkillStatusResult` (domain-qualified, collision-safe names).
- `@crustjs/testing`: `interactiveRun()` → `runInteractive()` (verb-first, consistent with `captureRun`/`captureExecute`).
