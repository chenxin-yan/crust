# @crustjs/skills

## 0.0.18

### Patch Changes

- 5cc32c7: Add `--all` flag to skill command for non-interactive installation to all detected agents
- bff135a: Use raw CLI name as the canonical skill directory name instead of prepending `use-`, and add legacy `use-*` install migration compatibility

## 0.0.17

### Patch Changes

- 954be97: Add custom instructions and command annotations support. Plugin-level `instructions` option renders top-level guidance into SKILL.md, and `annotate()` attaches agent-facing instructions to individual commands. Also forwards `license`, `allowedTools`, `compatibility`, and `disableModelInvocation` from plugin options to skill metadata.
- Updated dependencies [f78b327]
  - @crustjs/core@0.0.14

## 0.0.16

### Patch Changes

- 32449a1: Show supported agents in Universal skill option. When selecting agents for skill installation, the Universal option now displays which agents support the universal skill format (e.g., "Agents supporting universal skills: Amp, Cline, Codex, Cursor, Gemini CLI, GitHub Copilot, Kimi Code CLI, OpenCode, Replit").
- Updated dependencies [944f852]
- Updated dependencies [6dea64c]
- Updated dependencies [819bad7]
  - @crustjs/style@0.0.5
  - @crustjs/core@0.0.13
  - @crustjs/prompts@0.0.9

## 0.0.15

### Patch Changes

- 3a13f2b: Add canonical `.crust/skills` store with configurable symlink/copy install strategy.

  - Skill bundles are now rendered once to a canonical store (`.crust/skills/` for project scope, `~/.crust/skills/` for global scope) and then installed into agent-specific paths via symlink or copy.
  - Add `installMode` option (`"auto"` | `"symlink"` | `"copy"`) to `GenerateOptions` and `SkillPluginOptions`. Default `"auto"` creates symlinks with fallback to copy; `"symlink"` requires symlinks or fails; `"copy"` writes full copies.
  - Add `resolveCanonicalSkillPath()` export for resolving the canonical store path.
  - Uninstall now cleans up the canonical store when no agent install paths remain.
  - Export new `SkillInstallMode` type from package root.

- 42b05c7: Replace spawn-based agent detection with non-executing PATH lookup to prevent unrelated IDE CLIs from launching during normal CLI startup.

  - Replace `checkCommandAvailable`/`runCommand` (which spawned `<cmd> --version`, `<cmd> -v`, `<cmd> version`) with `isCommandOnPath()` — a pure filesystem PATH scan using `fs.accessSync` with `X_OK`. This eliminates the bare `version` positional arg that caused Electron-based IDEs (Antigravity, Kiro) to open on macOS.
  - Remove `detectInstalledAgents()` from `autoUpdateSkills` and `buildSkillUpdateCommand`. Auto-update and `skill update` now check all known agents via `skillStatus()` (filesystem-only), avoiding any PATH probing during normal CLI startup.
  - Keep `detectInstalledAgents()` only for the interactive `skill` command UX, now backed by the safe PATH lookup.

## 0.0.14

### Patch Changes

- b8ebfa4: Refine skill plugin ergonomics and tighten core public API boundaries.

  - `@crustjs/skills`:

    - `skillPlugin` now uses `command?: string` (default: `"skill"`) instead of `boolean | string`.
    - `skillPlugin` option `scope` was replaced with `defaultScope`.
    - Interactive scope selection now prompts for `project`/`global` only when `defaultScope` is not provided; non-interactive fallback is `global`.
    - Auto-update now checks both `project` and `global` install paths for the current cwd and reports scope in update messaging.
    - Added `skill update` subcommand for manual update-only runs.

  - `@crustjs/core`:
    - Removed `createCommandNode` and `computeEffectiveFlags` from the root `@crustjs/core` export surface.
    - High-level `Crust` builder usage is now the recommended path for command construction.

- 0944e0e: Normalize universal agent messaging in `skill` command output.

  - Auto-update messages now report universal targets as `Universal` instead of enumerating each supported universal agent.
  - Install and overwrite success output now prints a single `Universal -> <path>` entry for universal installs.
  - Remove output now reports `Removed from Universal` (and combines with additional agents when applicable).

- cd33d3f: Strengthen generated skill guidance to reduce CLI command hallucinations.

  - `SKILL.md` now explicitly requires reading the mapped command doc before giving command-specific answers.
  - Generated command docs now include an authority section stating that only documented flags/options/aliases/defaults are supported.
  - Rendering and e2e tests were updated to enforce the stricter verification contract.

- Updated dependencies [b8ebfa4]
  - @crustjs/core@0.0.12

## 0.0.13

### Patch Changes

- ab4b601: fix universal agent path issue

## 0.0.12

### Patch Changes

- a1329a2: Refactor skills agent handling to support a broader agent matrix with a universal install group. Detection now uses CLI command probes for additional agents, universal targets are exposed as a single selectable option, and prompt behavior includes already-installed additional targets even when the agent binary is not detected. Also simplify `crust.json` metadata and align docs with the new install and detection model.

## 0.0.11

### Patch Changes

- c089f62: Generate a single-file command reference by embedding all commands (including nested commands) directly in SKILL.md and removing command-index.md. Also clarify executable routing by documenting that any command labeled `runnable` (including `runnable, group`) can be executed.
- Updated dependencies [9f81bcc]
- Updated dependencies [72ea166]
  - @crustjs/core@0.0.11

## 0.0.10

### Patch Changes

- Updated dependencies [f704195]
  - @crustjs/prompts@0.0.8

## 0.0.9

### Patch Changes

- 96ca6b2: Adopt the new builder-style command API across core and official packages, including inherited flags, lifecycle hooks, plugin usage, and command metadata improvements. Update related tooling, templates, and documentation to align with the new command authoring flow.
- Updated dependencies [96ca6b2]
  - @crustjs/core@0.0.10

## 0.0.8

### Patch Changes

- f7d68ea: Support non-interactive mode for the `skill` command.

  - Detect TTY and conditionally pass `initial` to prompts so the command works in CI/piped environments.
  - In non-interactive mode, install skills to all detected agents automatically.
  - In non-interactive mode, skip conflict overwrite (safe default).

- 8c87b69: Refactor skill plugin: remove `autoInstall`, keep auto-update, polish UI.

  - Remove `autoInstall` option — the plugin now only auto-updates already-installed skills. First-time installation should be done via the interactive `skill` subcommand or programmatically using the exported primitives (`detectInstalledAgents`, `skillStatus`, `generateSkill`).
  - Move auto-update logic from middleware to setup phase, making it independent of plugin registration order.
  - Add scope-aware agent detection: `detectInstalledAgents()` now respects the configured scope (`global` or `project`) with fallback from project to global roots.
  - Accept options object in `detectInstalledAgents()` with backwards-compatible string parameter support.
  - Skip auto-update during build validation mode (`CRUST_INTERNAL_VALIDATE_ONLY`).
  - Use spinner from `@crustjs/prompts` for auto-update messages instead of raw `console.log`.
  - Style interactive command output with `@crustjs/style` (`bold`, `dim`, `yellow`).
  - Replace hardcoded defaults with `DEFAULT_SKILL_COMMAND_NAME` and `DEFAULT_SKILL_SCOPE` constants.
  - Move `@crustjs/prompts` and `@crustjs/style` from peer to direct dependencies.
  - Fix incorrect `skillPlugin()` JSDoc example that placed `plugins` inside `defineCommand()` instead of `runMain()`.

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
