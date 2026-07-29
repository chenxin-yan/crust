# @crustjs/skills

## 0.1.2

### Patch Changes

- 42979d9: Make `force: true` rewrite same-version generated skills and bundles in addition to overwriting conflicting install directories.
- Updated dependencies [e298f11]
  - @crustjs/utils@0.0.3
  - @crustjs/core@0.0.19

## 0.1.1

### Patch Changes

- 0dc69b1: Introduce `@crustjs/utils`, fold in `@crustjs/schema-utils`, dedupe `resolveSourceDir`, and switch validated helpers to explicit Standard Schema-backed validation.

  **`@crustjs/utils` (new, `0.0.1`)** — Pre-stable; public surface may change without notice until `0.1.0`. Pin to an exact version if depending externally.

  - `resolveSourceDir(input: string | URL): string` for three-mode source-directory resolution (`file:` URL via `fileURLToPath`, absolute path via `path.resolve`, or relative path resolved from the nearest `package.json` walking up from `process.argv[1]`).
  - `@crustjs/utils/schema` subpath exposes Standard Schema boundary assertions, issue normalization, and type aliases (`assertStandardSchema`, `isStandardSchema`, `formatPath`, `normalizeStandardIssues`, `normalizeStandardPath`, plus `StandardSchema` / `InferInput` / `InferOutput` / `ValidationIssue`). Internal-only — **not part of the public Crust API** and may change without a deprecation cycle. Use `@crustjs/validate` instead.
  - `@crustjs/utils/schema` is core-free shared infrastructure; package-specific APIs wrap errors at their own boundaries.

  **`@crustjs/schema-utils` removed.** The standalone workspace package is gone; its surface lives at `@crustjs/utils/schema`. The published `@crustjs/schema-utils@0.0.1` artifact on npm will be deprecated separately.

  **`@crustjs/core`, `@crustjs/validate`, `@crustjs/store` — raw schema-backed validation.** Vendor-specific schema introspection is removed; validated helpers now use Standard Schema validation over parsed values. `arg()`, `flag()`, and `field()` no longer infer type, requiredness, descriptions, multiplicity, or defaults from Zod/Effect internals. Missing values are passed to validation as `undefined`, so schema `.optional()` and `.default()` behavior applies naturally at runtime.

  - Validated positional args can omit parser `type`; they validate the raw positional string (or string array for variadic args) through the schema.
  - Validated CLI flags must declare parser `type` because it defines CLI grammar/token ownership: boolean flags do not consume a value, while string/number flags consume `--flag value` / `--flag=value`. Schemas validate and transform after parsing.
  - Descriptions must now be supplied through Crust options.
  - The internal `@crustjs/utils/schema` introspection exports (`inferOptions`, `extractDefault`, and related types) were removed.
  - This is a public behavior change for metadata-driven parser/help/store consumers: add explicit Crust metadata (`type`, `multiple`, `description`, `default`, etc.) where that metadata is still needed.

  **`@crustjs/create`, `@crustjs/skills` — internal dedup onto `resolveSourceDir`.** Public signatures and behavior of `createProject()` and `installSkillBundle()` are unchanged, but the wording of three thrown `Error` messages now comes from the shared helper:

  - `"Template URL must use file: protocol, got ..."` / `"Bundle URL must use file: protocol, got ..."` → `"sourceDir URL must use file: protocol, got ..."`
  - `"Could not resolve relative template path ..."` / `"Could not resolve relative bundle path ..."` → `"Could not resolve relative sourceDir ..."` (both `process.argv[1]` unset and missing-`package.json` variants)

  Consumers that match on `Error.message` text from these three failure modes will need to update their patterns. All other thrown messages (`Template directory does not exist`, `Template path is not a directory`, path-traversal rejection, `Bundle source directory does not exist`, missing `SKILL.md`, destination-conflict, etc.) are unchanged.

  The `@internal`-tagged `resolveBundleSourceDir` export from `@crustjs/skills/bundle` was removed. It carried `@internal` JSDoc and was undocumented (exported only for direct unit-test access); its behavior is preserved by `resolveSourceDir` from `@crustjs/utils`.

- Updated dependencies [0dc69b1]
- Updated dependencies [d08439a]
- Updated dependencies [d08439a]
- Updated dependencies [c4d2b22]
- Updated dependencies [c4d2b22]
  - @crustjs/utils@0.0.2
  - @crustjs/core@0.0.18

## 0.1.0

### Minor Changes

- 2de97e2: `skillPlugin` now accepts a `customSkills` array for managing hand-authored
  skill bundles alongside the auto-generated command-reference skill. Each
  entry runs through the same lifecycle as the main skill (auto-update,
  interactive multiselect, `skill update`) and adds its own multiselect
  prompt after the main one, in array order.

  ```ts
  import { Crust } from "@crustjs/core";
  import { skillPlugin } from "@crustjs/skills";
  import pkg from "./package.json" with { type: "json" };

  new Crust("my-cli")
  	.meta({ description: "My CLI" })
  	.use(
  		skillPlugin({
  			version: pkg.version,
  			customSkills: [
  				{
  					name: "funnel-builder",
  					sourceDir: "skills/funnel-builder",
  					version: pkg.version,
  				},
  			],
  		}),
  	)
  	.run(() => {});
  ```

  `CustomSkillConfig.sourceDir` accepts a `URL` (`file:` protocol), an
  absolute path, or a bare relative string resolved from the nearest
  `package.json` walking up from `process.argv[1]` — the same three modes
  used by `installSkillBundle()`. Each entry's `version` drives
  auto-update detection (compared against the recorded `crust.json`
  version) and is typically wired to the consuming package's
  `package.json` `version`. Per-entry `scope` and `installMode` overrides
  are optional; unset values inherit from the plugin's `defaultScope` /
  `installMode`.

  Setup-time validation enforces:

  - Each `name` satisfies `isValidSkillName`.
  - No `name` collides with the main skill's name.
  - All `name` values are unique within the array.
  - Each `version` is a non-empty string.
  - Each `sourceDir` is a `string` or `URL`.

  Bundle files are copied as raw bytes, so supporting binary assets round-trip
  unchanged. Passing `agents: []` to `installSkillBundle()` validates the
  bundle without installing it.

  Per-entry failures are logged with the bundle name and never abort other
  entries. Failures from explicit `skill --all` and `skill update` set a
  non-zero exit code so automation notices partial failures; startup
  auto-update remains warning-only. When `customSkills` is omitted or empty,
  only the generated main skill is managed.

  The bundle's `SKILL.md` frontmatter `name:` must equal the configured
  `name` — mismatches are rejected at install time so plugin status /
  uninstall paths can never drift from the canonical install location.

- 2de97e2: `CustomSkillConfig.version` is now optional in `skillPlugin`'s
  `customSkills`. When omitted, the entry inherits the plugin's top-level
  `version` — the typical case when the bundle ships in the same package as
  the consuming CLI. Pass an explicit value to opt into independent
  versioning (e.g. a bundle vendored from another package at a different
  release cadence).

  ```ts
  skillPlugin({
    version: pkg.version,
    customSkills: [
      // Inherits `version: pkg.version` from the plugin.
      { name: "funnel-builder", sourceDir: "skills/funnel-builder" },
      // Explicit override for an independently-versioned bundle.
      {
        name: "vendored-toolkit",
        sourceDir: "skills/vendored-toolkit",
        version: "0.3.0",
      },
    ],
  });
  ```

  This aligns `version` with how `scope` and `installMode` already inherit
  from the plugin. The existing required-`version` shape keeps working —
  all current configs are unchanged.

  Setup-time validation now rejects an explicit empty-string `version` so a
  typo can't silently fall through to the plugin-level fallback. Omitting
  the field entirely is the supported way to inherit.

- dac902a: **Add `installSkillBundle()` for hand-authored skill bundles.**

  New `installSkillBundle(options)` entrypoint installs a directory containing
  `SKILL.md` and supporting files through the same canonical-store + agent
  fan-out pipeline used by `generateSkill()`. The bundle's `SKILL.md`
  frontmatter is the source of truth for `name` and `description` — both are
  required, and Crust reads them without rewriting the file. `version` is a
  required option (typically wired to the consuming package's `package.json`
  `version`) recorded in `crust.json` for update detection. Files are copied
  as UTF-8 text (binary supporting files are not supported). Bundle contents
  are copied as authored — there is no implicit name-based filtering of
  `node_modules/`, dotfiles, etc.; bundle authors are responsible for
  pointing `sourceDir` at a clean directory. `crust.json` at the bundle
  root is reserved: if found in the source, the call throws so the conflict
  surfaces immediately. Crust then writes a fresh `crust.json` for
  ownership tracking. Symlinks that escape the bundle root are rejected.

  ```ts
  import { installSkillBundle } from "@crustjs/skills";
  import pkg from "./package.json" with { type: "json" };

  await installSkillBundle({
  	sourceDir: "skills/funnel-builder",
  	agents: ["claude-code"],
  	version: pkg.version,
  });
  ```

  `sourceDir` accepts an absolute path, a `file:` URL, or a relative path
  resolved from the nearest `package.json` walking up from `process.argv[1]`
  (matching `@crustjs/create`'s template resolution).

  **Additive `kind` field on `crust.json`.** Generated and bundle skills now
  record their origin in `crust.json` as `kind: "generated" | "bundle"`.
  Legacy `crust.json` files written before this field existed are read as
  `"generated"` for backward compatibility — existing generated installs
  continue to update cleanly without a migration step.

  **New `kindMismatch` and `manifestMalformed` details on `SkillConflictError`.**
  Attempting to install a bundle on top of a generated skill (or vice versa)
  at the same name now throws `SkillConflictError` with
  `details.kindMismatch: { existing, attempted }`. A directory whose
  `crust.json` exists but is unparseable, missing a version, or declares an
  unrecognized `kind` surfaces as `details.manifestMalformed: { reason,
rawKind? }`. Pass `force: true` to overwrite, or uninstall the existing
  skill first.

  `generateSkill()` behaviour is unchanged for existing callers.

  Resolves part of #110 (the lower-level primitive half; plugin integration
  via `skillPlugin({ customSkills })` is tracked separately).

### Patch Changes

- d4cd621: # Make `agents` optional on `generateSkill`, `uninstallSkill`, and `skillStatus`

  The `agents` field on `GenerateOptions`, `UninstallOptions`, and
  `StatusOptions` is now optional. The default differs by entrypoint so
  install behavior tracks the current machine, while uninstall and status
  sweep every known path:

  | Entrypoint                      | Default when `agents` is omitted                              | `PATH` I/O? |
  | ------------------------------- | ------------------------------------------------------------- | ----------- |
  | `generateSkill`                 | `[...getUniversalAgents(), ...await detectInstalledAgents()]` | Yes         |
  | `uninstallSkill`, `skillStatus` | Every supported agent (exhaustive sweep of all known paths)   | No          |

  In all three, `agents: []` is treated as a no-op (no install, uninstall, or
  status entries). An explicit array always overrides the default.

  **Behavior change.** Existing callers that pass an explicit `agents` array
  keep their current behavior. Callers that omit `agents` (or pass
  `agents: undefined`, which is common from object spread) now trigger the
  defaults above:

  - `generateSkill` performs filesystem I/O via `detectInstalledAgents()` to
    probe `PATH` for installed agent CLIs.
  - `uninstallSkill` and `skillStatus` do not probe `PATH`; they iterate the
    full agent registry and stat each per-agent path, which can return a
    larger result set than before (one entry per supported agent).

  **Migration.**

  ```ts
  // Before — manual composition of universals + detected agents
  const universal = getUniversalAgents();
  const additional = await detectInstalledAgents();
  await generateSkill({
    command,
    meta,
    agents: [...universal, ...additional],
    scope: "global",
  });

  // After — same result, no manual composition
  await generateSkill({ command, meta, scope: "global" });
  ```

  `getUniversalAgents()`, `getAdditionalAgents()`, and
  `detectInstalledAgents()` remain exported for callers who want fine-grained
  control.

  **Bug fix.** `detectInstalledAgents()` no longer reports a command as
  installed when the matching `PATH` entry is an executable directory rather
  than a file. The probe now requires the entry to be a regular file (or
  symlink to one) before checking the `X_OK` bit.

- Updated dependencies [075490b]
- Updated dependencies [b87e0ee]
- Updated dependencies [f1baa45]
- Updated dependencies [075490b]
- Updated dependencies [8779692]
- Updated dependencies [67f815a]
- Updated dependencies [82f5ad6]
- Updated dependencies [9db2613]
- Updated dependencies [3421dbf]
  - @crustjs/style@0.2.0
  - @crustjs/core@0.0.17
  - @crustjs/prompts@0.1.0
  - @crustjs/progress@0.0.4

## 0.0.24

### Patch Changes

- Updated dependencies [df08a3a]
- Updated dependencies [7ca5e5f]
- Updated dependencies [df08a3a]
- Updated dependencies [67a9f25]
  - @crustjs/style@0.1.0
  - @crustjs/prompts@0.0.13
  - @crustjs/progress@0.0.3

## 0.0.23

### Patch Changes

- Updated dependencies [23fae62]
  - @crustjs/prompts@0.0.12

## 0.0.22

### Patch Changes

- 2ea1028: Suppress the universal skills agent hint when the skill command runs non-interactively.

  This keeps `skill` output focused on actual changes and avoids showing the universal agent support list during no-op runs that default to the current installed selection.

- 341f3b1: Add a new `@crustjs/progress` package and move the canonical `spinner()` implementation there.

  `@crustjs/prompts` now temporarily re-exports `spinner` and related types as deprecated compatibility exports, with removal planned for `v0.1.0`.

  Update internal consumers and docs to use `@crustjs/progress` as the new home for spinner-based progress UI.

- Updated dependencies [def425e]
- Updated dependencies [341f3b1]
  - @crustjs/core@0.0.16
  - @crustjs/progress@0.0.2
  - @crustjs/prompts@0.0.11

## 0.0.21

### Patch Changes

- 687b1b8: Fix scope resolution in skill auto-update to properly deduplicate project and global scopes when they resolve to the same effective scope.
- Updated dependencies [9b57c50]
  - @crustjs/style@0.0.6
  - @crustjs/prompts@0.0.10

## 0.0.20

### Patch Changes

- 4634996: Strengthen rendered skill workflow prompts to use stricter dictation tone so agents follow command documentation more consistently.

## 0.0.19

### Patch Changes

- Updated dependencies [5e0afa4]
  - @crustjs/core@0.0.15

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
