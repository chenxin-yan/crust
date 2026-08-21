---
"@crustjs/skills": minor
---

Rework `@crustjs/skills` around a package-as-source model (breaking).

- Build time: `writeSkills()` renders generated and authored skills into a self-describing, package-ready skill source without installing them. Hand-authored skill directories are included via `extras`; `version` is optional and only recorded in the generated SKILL.md `metadata` block. The `skill()` Extension takes the packaged source as `distDir` and can build authored extras alongside generated command documentation.
- Install time: packaged skills install through symlinks only. Project links use relative, logical package paths verified across npm, pnpm, and Bun; global links use absolute paths; installation fails clearly when the environment cannot create symlinks. Packaged skills are discovered from required `name` and `description` fields in `SKILL.md` frontmatter (frontmatter without a closing `---` fence is rejected). Ownership comes from symlink targets ending in `skills/<name>`; the pre-run hook repairs owned dangling or stale-target links, and uninstall unlinks owned entries. `crust.json` ownership/version manifests and version-based synchronization are removed.
- `getSkillStatus()` (formerly `skillStatus()`) reports `linked`, `dangling`, `conflict`, or `absent`. Install results replace `updated` with `repaired`; `PackagedSkill` no longer includes `version`; the `SkillKind` export is removed.
- Removed runtime generation APIs: `annotate()`, `generateSkill()`, `installSkillBundle()`, `resolveSkillName()`, and their option/result types. Command guidance belongs in `meta.sections`; use `writeSkills()` at build time and `installSkill()` for opt-in installation.
- `detectInstalledAgents()` drops its string form and the unused `scope` and `home` options.
- Agent matrix: Warp and Zed are new universal targets, and `pi` is reclassified as universal (it discovers `~/.agents/skills/` and project `.agents/skills/` natively). Antigravity and Mistral Vibe installation paths follow their current conventions. Existing links in old locations — Pi's `~/.pi/agent/skills/` and `.pi/skills/`, Antigravity's `.agent/skills/` and `~/.gemini/antigravity/skills/`, and `~/.vibe/skills/` when `VIBE_HOME` points elsewhere — are no longer managed; remove them manually if present.
- Generated content: every packaged skill is advertised in root help and generated man pages with its description and resolved source path, and SKILL.md command reference tables include command descriptions.
