---
"@crustjs/skills": minor
---

Rename the `writeSkills` `bundles` option to `extras` — hand-authored skill directories included alongside the generated skill. Make `version` optional: it is only recorded in the generated skill's SKILL.md `metadata` block, which is omitted when no version is provided.
