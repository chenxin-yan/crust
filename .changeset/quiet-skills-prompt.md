---
"@crustjs/skills": minor
---

Interactive installation now selects packaged skills once (when several are packaged) and agents once, instead of prompting per skill; unselected skills are left untouched. Add `skills install` (same as the root command) and `skills uninstall`, and rename `skills update` to `skills repair` (breaking: the `update` name is removed).
