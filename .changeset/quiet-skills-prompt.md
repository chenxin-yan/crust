---
"@crustjs/skills": minor
---

Prompt once for skills and once for agents when installing packaged skills, instead of one agent prompt per skill. With several packaged skills, `skills` first asks which to install (unselected skills are left untouched), then asks which agents to install them for. Add `skills install` (same as the root command) and `skills uninstall`, and rename `skills update` to `skills repair` (breaking: the `update` name is removed).
