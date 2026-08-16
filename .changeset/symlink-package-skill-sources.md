---
"@crustjs/skills": minor
---

Install packaged skills through symlinks only. Project links use relative, logical package paths; global links use absolute paths. Installation now fails clearly when the environment cannot create symlinks rather than falling back to another mechanism.

Remove `crust.json` ownership/version manifests and version-based synchronization. Packaged skills are discovered from required `name` and `description` fields in `SKILL.md` frontmatter. Dangling symlink targets ending in `skills/<name>` remain repairable, while resolving links are accepted only when they point to the expected packaged source. The pre-run hook warns and continues on repair errors, and source-aware uninstall leaves resolving wrong-target links untouched.

`getSkillStatus()` now reports `linked`, `dangling`, `conflict`, or `absent`. `PackagedSkill` no longer includes `version`, install results replace `updated` with `repaired` and drop the obsolete `files` snapshot, and the `SkillKind` export is removed.

This also completes the package-as-source API rework: use `writeSkills()` at build time and `installSkill()` for opt-in installation. The former runtime generation APIs (`annotate()`, `generateSkill()`, `installSkillBundle()`, `resolveCanonicalSkillPath()`, and the `./annotations` export) remain removed; command guidance belongs in `meta.sections`.
