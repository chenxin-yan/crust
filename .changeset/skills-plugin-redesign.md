---
"@crustjs/core": patch
"@crustjs/skills": patch
---

Add `addSubCommand` to plugin `SetupActions`, allowing plugins to inject subcommands during setup. User-defined subcommands take priority over plugin-injected ones. `Command.subCommands` is now always initialized (non-optional).

Redesign `@crustjs/skills` from a build-time CLI tool into a runtime plugin. `skillPlugin()` handles auto-update of installed skills and optionally registers an interactive `skill` subcommand via `addSubCommand`. Skill metadata (name, description) is derived from the root command — only `version` needs to be supplied. Remove `createSkillCommand` and `SkillCommandOptions` from public API.
