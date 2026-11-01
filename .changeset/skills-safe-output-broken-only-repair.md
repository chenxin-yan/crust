---
"@crustjs/skills": patch
"@crustjs/utils": patch
---

Generated skill tables fold line breaks in descriptions into spaces, so a multi-line flag, argument, or command description no longer breaks the markdown table.

An authored `SKILL.md` whose `name` or `description` uses a YAML block scalar (`|`, `>-`) is now rejected with an error asking for a one-line value. Previously the indicator itself (`">-"`) became the skill's description.

The background auto-repair before ordinary commands now repairs only owned links whose target no longer exists. A link to another live installed copy of the CLI (global versus project-local, `npx`) is left alone, so two copies no longer move the link back and forth on every run. `skills repair` and `installSkill()` still re-point such links.

`@crustjs/skills` loads `@crustjs/prompts` and `@crustjs/progress` only when the `skills` command runs. `installSkill()`, `uninstallSkill()`, and `getSkillStatus()` accept readonly `agents` arrays.

Relative skill source paths now resolve from the package that owns a symlinked entrypoint (an npm-linked `node_modules/.bin` script) instead of the consumer's package.
