---
"@crustjs/skills": minor
---

**Breaking:** the `skill()` Extension is renamed `skills()`, one lower-case factory named for the feature, as `mcp()` and `man()`. Replace `.extend(skill({}))` with `.extend(skills({}))` and `only: [skill]` with `only: [skills]`. The command is still `skills`, with its `skill` alias.
