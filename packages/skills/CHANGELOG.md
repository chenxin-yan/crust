# @crustjs/skills

## 0.0.7

### Patch Changes

- Updated dependencies [81608ea]
  - @crustjs/prompts@0.0.7

## 0.0.6

### Patch Changes

- a1f233e: Enable minification for all package builds, reducing bundle sizes by ~27%. Also shorten error messages in `@crustjs/core` for smaller output.
- Updated dependencies [a1f233e]
- Updated dependencies [b17db37]
- Updated dependencies [e3624b2]
  - @crustjs/core@0.0.9
  - @crustjs/prompts@0.0.6

## 0.0.5

### Patch Changes

- Updated dependencies [695854e]
  - @crustjs/prompts@0.0.5

## 0.0.4

### Patch Changes

- 7be331c: Improve `skillPlugin()` auto-install messaging to clearly distinguish first-time installs from updates. Auto-installs now print an explicit notification, and when the interactive command is enabled, the message includes a `my-cli skill` management hint.
- 5c0d1b3: Enable `skillPlugin()` interactive command injection by default. The `skill` subcommand is now registered unless `command: false` is explicitly set, reducing setup friction for skill management. Update `SkillPluginOptions` docs to reflect `command` defaulting to `true` and clarify the opt-out behavior.
- 0221ca7: Rename `manifest.json` to `crust.json` and add conflict detection for non-Crust skill directories. `generateSkill()` now throws `SkillConflictError` when the target directory exists but lacks a `crust.json`, preventing silent overwrites of manually created or third-party skills. The plugin middleware warns and skips, while the interactive `skill` command prompts the user to confirm overwriting. A `force` option is available on `GenerateOptions` for programmatic override.
- 6d8aaf0: Harden SKILL.md generation with bug fixes and new features:

  **Bug fixes:** YAML frontmatter values containing special characters (`:`, `#`, `*`, `!`, etc.) are now properly escaped with double quotes. Markdown table cells in args/flags tables now escape literal `|` characters to prevent broken rendering.

  **New features:** Added `isValidSkillName()` export that validates skill names against the Agent Skills spec pattern (`^[a-z0-9]+(-[a-z0-9]+)*$`, 1–64 chars); `generateSkill()` now throws on invalid names. Added optional `allowedTools`, `license`, `compatibility`, and `disableModelInvocation` fields to `SkillMeta`, emitted conditionally in YAML frontmatter.

  **Improved output:** SKILL.md now includes "when to use this skill" guidance text derived from the skill description, and uses stronger directive language for lazy-loading command files.

## 0.0.3

### Patch Changes

- 1d75efd: Rewrite interactive skill command to single multiselect prompt and add `use-` prefix idempotency guard to `resolveSkillName`

## 0.0.2

### Patch Changes

- 384e2a9: Add `addSubCommand` to plugin `SetupActions`, allowing plugins to inject subcommands during setup. User-defined subcommands take priority over plugin-injected ones. `Command.subCommands` is now always initialized (non-optional).

  Redesign `@crustjs/skills` from a build-time CLI tool into a runtime plugin. `skillPlugin()` handles auto-update of installed skills and optionally registers an interactive `skill` subcommand via `addSubCommand`. Skill metadata (name, description) is derived from the root command — only `version` needs to be supplied. Remove `createSkillCommand` and `SkillCommandOptions` from public API.

- Updated dependencies [384e2a9]
  - @crustjs/core@0.0.8
