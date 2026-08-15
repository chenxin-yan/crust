---
"@crustjs/skills": minor
---

Replace runtime generation, the mutable canonical store, and link install modes with copy-only installation from packaged skill sources.

Removed APIs and their replacements:

- `annotate()` and the `./annotations` export — author command instructions with `meta.sections` instead.
- `generateSkill()` / `installSkillBundle()` — render skills at build time with `writeSkills()` and install them with `installSkill()`.
- `resolveCanonicalSkillPath()` — there is no canonical store; installs copy directly from the packaged source resolved via `resolveSkillSource()`.
- The `SkillMeta` fields `license`, `compatibility`, `disableModelInvocation`, `allowedTools`, and `instructions` (and the `SkillMeta` root export) — generated `SKILL.md` frontmatter now carries only `name`, `description`, and the version marker; per-command guidance moves to `meta.sections`.
