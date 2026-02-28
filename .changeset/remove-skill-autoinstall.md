---
"@crustjs/skills": patch
---

Remove `autoInstall` option from `skillPlugin` — the plugin now only auto-updates already-installed skills. First-time installation should be done via the interactive `skill` subcommand or programmatically using the exported primitives (`detectInstalledAgents`, `skillStatus`, `generateSkill`).
