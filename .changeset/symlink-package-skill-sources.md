---
"@crustjs/skills": major
---

Install packaged skills through symlinks only. Project links use relative, logical package paths verified across npm, pnpm, and Bun; global links use absolute paths. Installation now fails clearly when the environment cannot create symlinks rather than falling back to another mechanism.

Remove `crust.json` ownership/version manifests and version-based synchronization. Packaged skills are discovered from required `name` and `description` fields in `SKILL.md` frontmatter. Ownership comes from symlink targets ending in `skills/<name>`; the pre-run hook repairs owned dangling or stale-target links, and uninstall unlinks owned entries.

`getSkillStatus()` now reports `linked`, `dangling`, `conflict`, or `absent`. `PackagedSkill` no longer includes `version`, install results replace `updated` with `repaired`, and the `SkillKind` export is removed.

This also completes the package-as-source API rework: use `writeSkills()` at build time and `installSkill()` for opt-in installation. The former runtime generation APIs (`annotate()`, `generateSkill()`, `installSkillBundle()`, `resolveCanonicalSkillPath()`, and the `./annotations` export) remain removed; command guidance belongs in `meta.sections`.
