---
"@crustjs/extensions": minor
"@crustjs/skills": minor
"@crustjs/testing": minor
---

Consolidate public naming conventions:

- `@crustjs/extensions`: Name the version extension options `VersionOptions` (matching `CompletionOptions`, `DidYouMeanOptions`, and `UpdateNotifierOptions`).
- `@crustjs/skills`: Rename `skillStatus()` to `getSkillStatus()`; rename `GenerateOptions`/`GenerateResult` to `GenerateSkillOptions`/`GenerateSkillResult`, `UninstallOptions`/`UninstallResult` to `UninstallSkillOptions`/`UninstallSkillResult`, and `StatusOptions`/`StatusResult` to `SkillStatusOptions`/`SkillStatusResult` (domain-qualified, collision-safe names).
- `@crustjs/testing`: Name the interactive runner `runInteractive()` (verb-first, consistent with `captureRun` and `captureExecute`).
