---
"@crustjs/skills": patch
---

Enable `skillPlugin()` interactive command injection by default. The `skill` subcommand is now registered unless `command: false` is explicitly set, reducing setup friction for skill management. Update `SkillPluginOptions` docs to reflect `command` defaulting to `true` and clarify the opt-out behavior.
