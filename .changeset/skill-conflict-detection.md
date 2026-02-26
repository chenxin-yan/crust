---
"@crustjs/skills": patch
---

Rename `manifest.json` to `crust.json` and add conflict detection for non-Crust skill directories. `generateSkill()` now throws `SkillConflictError` when the target directory exists but lacks a `crust.json`, preventing silent overwrites of manually created or third-party skills. The plugin middleware warns and skips, while the interactive `skill` command prompts the user to confirm overwriting. A `force` option is available on `GenerateOptions` for programmatic override.
