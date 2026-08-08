# @crustjs/plugins

## 0.2.0

### Minor Changes

- [#139](https://github.com/chenxin-yan/crust/pull/139) [`0ce45f4`](https://github.com/chenxin-yan/crust/commit/0ce45f4cd41cc4c9ef4181a23ea6360fd756b49b) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Ship the 0.2 API revamp for the framework spine (see `docs/adr/0001`–`0009`):

  - Extensions replace plugins: `@crustjs/extensions` package, `defineExtension(name, config)` plain frozen configs with `intercept(ctx, next)` and `handleError` presentation chain; `.use()` removed.
  - Contexts are command dependencies: `defineContext(name, config?, setup)` always returns a factory, attached with the variadic `.provide(...)`, constructed topologically by declared `requires` dependencies (values arrive via `ctx`), and disposed via native `Symbol.dispose`/`Symbol.asyncDispose` in reverse construction order.
  - `.handle(handler)` defines the Command Handler; `.run(argv, { stdout, stderr })` throws for programmatic embedding; `.execute()` renders and sets `process.exitCode`. `preRun`/`postRun` removed.
  - `CrustError` keeps four stable codes (`DEFINITION`, `PARSE`, `VALIDATION`, `COMMAND_NOT_FOUND`); `_tag`, `CONFIG`, and `EXECUTION` removed; handler and Context errors pass through unwrapped.
  - Standard Schema supported directly on arg/flag definitions; `@crustjs/validate` removed.
  - Public `CommandNode`/`prepareCommandTree()` removed; serializable Command Snapshots cross public boundaries; man/crust/skills consume the unsupported `@crustjs/core/tooling` subpath.
  - `create-crust` ships a single minimal template.

  This is a hard cut from the 0.1 API with no compatibility shims; each removed name's replacement is listed above.

- [#164](https://github.com/chenxin-yan/crust/pull/164) [`2a3250e`](https://github.com/chenxin-yan/crust/commit/2a3250e3e78fc780b873ae9a1b4069997b1f0235) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Add a shared presentation-neutral command documentation model to `@crustjs/core/tooling` and use it for help, mdoc, and Agent Skill rendering.

  Help headings now follow conventional title case and list negation for every long alias. Man pages use semantic mdoc flag and argument macros. Generated skills omit hidden commands.

- [#149](https://github.com/chenxin-yan/crust/pull/149) [`db943af`](https://github.com/chenxin-yan/crust/commit/db943af22e3d7e8766b396edd845487368040435) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - `ExtensionConfig.commands` now accepts only `defineCommand()` definitions. Migrate extension-owned `new Crust("name")` builders to `defineCommand("name", (command) => ...)`; `ExtensionCommand` is removed. Definition Context requirements are checked when the application prepares and report `DEFINITION` errors.

- [#146](https://github.com/chenxin-yan/crust/pull/146) [`eb0add9`](https://github.com/chenxin-yan/crust/commit/eb0add9272d93f734ecf321e0b481a0aaf6da57e) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Replace Extension `intercept(ctx, next)` and `handleError(error, ctx, next)` with named `hooks`: `preRun(ctx)`, `postRun(ctx, outcome)`, and `onError(error, ctx)`. `preRun` returns `ctx.finish()` to short-circuit successfully; `postRun` runs in reverse extension order after every settled invocation; `onError` returns `true` after rendering an `execute()` failure.

  Command Handlers now receive `rootCommand`, including handlers for Extension-owned commands. Migrate Extension-owned routing work into real `.handle()` callbacks.

- [#150](https://github.com/chenxin-yan/crust/pull/150) [`ac028c8`](https://github.com/chenxin-yan/crust/commit/ac028c8a8694fc4d685ed7140353a881bc92aeb6) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - `help()` now renders long flag aliases (e.g. `-o, --output, --out`). Negation is shown for the canonical name only; man pages remain the exhaustive reference.

- [#169](https://github.com/chenxin-yan/crust/pull/169) [`048edf2`](https://github.com/chenxin-yan/crust/commit/048edf27d71b05e89426010064bf7c5be37fc0c6) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Consolidate public naming conventions:

  - `@crustjs/extensions`: Name the version extension options `VersionOptions` (matching `CompletionOptions`, `DidYouMeanOptions`, and `UpdateNotifierOptions`).
  - `@crustjs/skills`: Rename `skillStatus()` to `getSkillStatus()`; rename `GenerateOptions`/`GenerateResult` to `GenerateSkillOptions`/`GenerateSkillResult`, `UninstallOptions`/`UninstallResult` to `UninstallSkillOptions`/`UninstallSkillResult`, and `StatusOptions`/`StatusResult` to `SkillStatusOptions`/`SkillStatusResult` (domain-qualified, collision-safe names).
  - `@crustjs/testing`: Name the interactive runner `runInteractive()` (verb-first, consistent with `captureRun` and `captureExecute`).

- [#153](https://github.com/chenxin-yan/crust/pull/153) [`98cf6d1`](https://github.com/chenxin-yan/crust/commit/98cf6d193ddabdb9f1f9421935698e79bfc8cc6d) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - **BREAKING:** Remove `FlagDef.inherit`. Command flags declared with `.flags()` are now always local; Context-owned flags are the only application-level flag propagation mechanism. Recursive Extension flags continue to use `ExtensionFlagDef.recursive`.

  The public `FlagSnapshot.inherit` field and the internal `InheritableFlags` and `ForceInherit` utility types are also removed. A local child flag can no longer override a same-named inherited flag because ordinary flags no longer inherit; Context-owned name collisions remain `DEFINITION` errors.

  | Previous usage                                     | Migration                                                                                                                                                                                        |
  | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | `inherit: true` feeds behavior shared by a subtree | Move the flag into `defineContext(name, { flags: [...] }, setup)` and attach the instance with `.provide()` before mounting descendants. Handlers should require the derived Context capability. |
  | Each command reads the raw flag directly           | Define the descriptor once with `defineFlag()` and attach it with `.flags()` to each command that parses it.                                                                                     |

  Cross-command dependencies are capability-only: list Context factories in `requires` and consume their derived values through `ctx`. Raw flag requirements are removed.

- [#139](https://github.com/chenxin-yan/crust/pull/139) [`0ce45f4`](https://github.com/chenxin-yan/crust/commit/0ce45f4cd41cc4c9ef4181a23ea6360fd756b49b) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Require Bun 1.3.14 or newer across all published packages and remove the obsolete sync-disposal workaround now that `AsyncDisposableStack.use()` supports `Symbol.dispose`.

- [#145](https://github.com/chenxin-yan/crust/pull/145) [`40fb8bd`](https://github.com/chenxin-yan/crust/commit/40fb8bd8346a2d248a454104f580b88231377bf2) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Replace the bespoke global color knob with the standard environment variables:

  - `@crustjs/style`: `setGlobalColorMode` / `getGlobalColorMode` removed. The default `style` facade and top-level helpers re-resolve `NO_COLOR` / `FORCE_COLOR` / TTY on every call — set those variables instead. This also removes the word-collision where facade-`"never"` and `createStyle({ mode: "never" })` meant different things: `ColorMode` is now purely an instance concept (`"never"` = all ANSI off), while the environment is the global channel (`NO_COLOR` = colors off per no-color.org, `FORCE_COLOR` = the all-ANSI switch).
  - `@crustjs/style`: capability detection now honors `FORCE_COLOR` (chalk convention): `0`/`false` force all ANSI off; `1`/`2`/`3` force color at 16/256/truecolor depth; other values force on at the detected depth. `FORCE_COLOR` takes precedence over `NO_COLOR` and TTY. `CapabilityOverrides` gains `forceColor`.
  - `@crustjs/extensions`: `noColor()` now scopes `FORCE_COLOR`/`NO_COLOR` around command execution instead of calling the removed knob — `--color` sets `FORCE_COLOR=3` (clearing `NO_COLOR` so strict no-color.org-only child processes also comply), `--no-color` sets `NO_COLOR=1` (clearing `FORCE_COLOR`), restoring prior values after the run. The flag now also affects child processes and other `FORCE_COLOR`-aware libraries. Note: `--no-color` with piped output is now fully plain — previously modifiers/hyperlinks could still be emitted off-TTY.

- [#152](https://github.com/chenxin-yan/crust/pull/152) [`ff01466`](https://github.com/chenxin-yan/crust/commit/ff01466931a7f0616ac01e9ea6be2285f702344f) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - `versionExtension(value, options?)` accepts a new `format` option controlling output: `"plain"` prints the bare version, or a `(version, context) => string` function customizes the line. Default output is unchanged (`<name> v<version>`).

### Patch Changes

- [#139](https://github.com/chenxin-yan/crust/pull/139) [`0ce45f4`](https://github.com/chenxin-yan/crust/commit/0ce45f4cd41cc4c9ef4181a23ea6360fd756b49b) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Documentation consolidation: package READMEs are now concise stubs linking to the docs site (crustjs.com), unique README content moved into the docs, and public option/type TSDoc was enriched (descriptions, `@default` tags) to back generated API reference tables. No runtime behavior changes.

- [#139](https://github.com/chenxin-yan/crust/pull/139) [`0ce45f4`](https://github.com/chenxin-yan/crust/commit/0ce45f4cd41cc4c9ef4181a23ea6360fd756b49b) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Use Bun's SemVer precedence for update notifications, including notifying prerelease users when the matching stable release becomes available, and simplify extension internals.

- Updated dependencies [[`30a75dd`](https://github.com/chenxin-yan/crust/commit/30a75dddf9256c102a1ead7165cc81ef1c4ec0f5), [`0ce45f4`](https://github.com/chenxin-yan/crust/commit/0ce45f4cd41cc4c9ef4181a23ea6360fd756b49b), [`0ce45f4`](https://github.com/chenxin-yan/crust/commit/0ce45f4cd41cc4c9ef4181a23ea6360fd756b49b), [`0ce45f4`](https://github.com/chenxin-yan/crust/commit/0ce45f4cd41cc4c9ef4181a23ea6360fd756b49b), [`0ce45f4`](https://github.com/chenxin-yan/crust/commit/0ce45f4cd41cc4c9ef4181a23ea6360fd756b49b), [`40fb8bd`](https://github.com/chenxin-yan/crust/commit/40fb8bd8346a2d248a454104f580b88231377bf2), [`40fb8bd`](https://github.com/chenxin-yan/crust/commit/40fb8bd8346a2d248a454104f580b88231377bf2)]:
  - @crustjs/style@0.3.0

## 0.1.2

### Patch Changes

- @crustjs/core@0.0.19

## 0.1.1

### Patch Changes

- c4d2b22: Completion templates now emit file completion for `type: "path"` flags and positional arguments (bash `compgen -f`, zsh `_files`, fish `__fish_complete_path`). File completion is explicitly suppressed for `type: "url"` and `type: "json"` flags/arguments — the existing string fallback used to offer filenames for any value-taking string flag, which is semantically wrong for URLs and JSON literals.
- Updated dependencies [0dc69b1]
- Updated dependencies [d08439a]
- Updated dependencies [c4d2b22]
- Updated dependencies [c4d2b22]
  - @crustjs/core@0.0.18

## 0.1.0

### Minor Changes

- 8779692: Add `completionPlugin` for shell tab-completion.

  The new plugin registers a `completion <shell>` subcommand on the root command
  that emits a self-contained tab-completion script for **bash**, **zsh**, or
  **fish**. The strategy is **pure-static**: the plugin walks the live command
  tree at run time and prints a fully-baked script. There are no runtime
  callbacks, no hidden `__complete` subcommand, and no shell-out on TAB — the
  generated script is the artifact users install into their shell.

  ```ts
  import { Crust } from "@crustjs/core";
  import { completionPlugin } from "@crustjs/plugins";

  new Crust("my-cli")
    .use(completionPlugin({ version: "1.0.0" }))
    .command("build", (cmd) =>
      cmd
        .flags({
          target: { type: "string", choices: ["browser", "bun", "node"] },
        })
        .run(() => {})
    )
    .run(() => {});
  ```

  ```sh
  # Print to stdout — pipe into the shell's auto-discovery directory.
  my-cli completion bash > ~/.local/share/bash-completion/completions/my-cli

  # Or generate every supported shell at packaging time.
  my-cli completion bash --output-dir completions/
  # → completions/my-cli, completions/_my-cli, completions/my-cli.fish
  ```

  Highlights:

  - **All three shells from one walk.** The bash template ships a Cobra-style
    init shim so it works on systems without the `bash-completion` package
    (macOS default bash, Alpine, NixOS without the package), handles the
    `--` end-of-options terminator, the `--name=value` form, and value-flag
    context. The zsh template uses `_arguments -C` with `->state` subcommand
    routing and emits description-rich menus, including positional choices
    and `_files` fallback for free-form string flags. The fish template
    emits declarative `complete -c` rules gated on a per-script ordered
    path predicate that walks `commandline -opc` left-to-right — unlike
    fish's stock `__fish_seen_subcommand_from`, the predicate is order-
    sensitive, so nested commands that reuse names at different depths
    route correctly.
  - **Choices and aliases surface end-to-end.** Static enums declared via
    the `choices` field on `FlagDef`/`ArgDef` become value lists in the
    generated scripts (flags **and** the first positional arg, in all
    three shells). Command aliases (`meta.aliases`) are tab-completable
    and resolve to the canonical command's flags. Boolean toggles also
    surface their `--no-<name>` negation candidate (unless `noNegate: true`).
  - **Strict input validation.** Command names, flag names, flag aliases,
    short flags, arg names, and `binName` must match
    `/^[A-Za-z0-9][A-Za-z0-9._-]*$/`. Choice values must match
    `/^[A-Za-z0-9][A-Za-z0-9_.+:@/-]*$/`. The plugin throws at `setup()`
    time with a clear error if any input falls outside this set, rather
    than silently mis-quote the generated script. Description text and the
    `version` string flow through per-shell escapes; control characters
    are scrubbed at the boundary so they cannot break out of comment lines.
    `binName` is additionally rejected if it contains path separators or
    `..`, and the `--output-dir` writer verifies that resolved paths stay
    inside the requested directory.
  - **`--output-dir` for distributors.** Writes all configured shells with
    the canonical filenames Homebrew, Nix, AUR, and Debian expect
    (`<bin>` for bash, `_<bin>` for zsh, `<bin>.fish` for fish) — no rename
    needed. Use the `shells` option to scope down.
  - **Drift is mitigated by versioned headers.** Each generated script's
    first line embeds the binary name and version, so users (and `diff`)
    spot stale completion files at a glance, with the regenerate command
    inline.

  Limitations (v1):

  - No dynamic value completion (per-flag/per-arg `complete?:` callbacks);
    intentionally deferred to a future minor bump. Adding them is
    non-breaking, so v1 ships pure-static today and grows into a hybrid later.
  - No PowerShell template (planned for v2).

- 8779692: Make the `choices`, `meta.aliases`, and `meta.hidden` contracts consistent
  across every consumer (help, did-you-mean, man, completion).

  A cross-consumer audit found three gaps:

  - `helpPlugin` rendered output omitted the `choices` list for both flags
    and positional args, so users could not discover valid values from
    `--help` without resorting to shell completion or source-reading.
  - `didYouMeanPlugin` and the `@crustjs/man` manpage generator both
    walked the command tree without filtering `meta.hidden: true`, so
    internal commands (e.g. `__complete`) leaked into typo suggestions,
    the "Available commands" fallback, and published man pages.
  - `@crustjs/man` omitted long flag aliases (`def.aliases`) and `choices`
    from the OPTIONS / ARGUMENTS sections, leaving the man page strictly
    less informative than `--help`.
  - The completion plugin's bash and fish templates only surfaced
    `choices` for the **first** positional argument; zsh respected every
    slot. Variadic-with-choices arguments and multi-positional commands
    silently fell through to file completion in bash/fish.

  Changes:

  - `helpPlugin` renders `[choices: a, b, c]` after the description for
    every flag and arg that declares a `choices` list, composed with
    `[default: ...]` when both are present.
  - `didYouMeanPlugin` skips `meta.hidden: true` siblings in both the
    Levenshtein suggestion corpus (canonical names **and** aliases) and
    the "Available commands" fallback list.
  - `@crustjs/man` filters `meta.hidden: true` subcommands from the
    SUBCOMMANDS section (and skips the section entirely when every
    subcommand is hidden), surfaces flag and arg `choices` as a
    `[choices: ...]` suffix, and includes long flag aliases in OPTIONS
    labels (`-o, --output, --out`, plus `--no-` negation for every long
    spelling on boolean flags).
  - `completionPlugin` bash and fish templates now track positional slot
    index past the resolved command path and emit per-slot choice
    candidates. Variadic-with-choices arguments are handled correctly
    (the choice list applies at every slot from the variadic's declared
    index onwards). The fish template gains a second per-script helper
    `__<ident>_path_at_arg` that the existing `__<ident>_path_is` is
    layered alongside; subcommand and flag rules continue to use the
    original predicate.

  Core / docs:

  - `CommandMeta.hidden` JSDoc now enumerates every tooling surface the
    flag affects (help, completion, did-you-mean, man, skills) and is
    explicit that there is intentionally no analogous `FlagDef.hidden` —
    the workaround for flag-level hiding is to register without a
    description.

### Patch Changes

- f1baa45: `helpPlugin` and `didYouMeanPlugin` are alias-aware.

  `helpPlugin`'s `COMMANDS:` section now renders the canonical name with any aliases inline as `name (alias1, alias2)` — e.g. `issue (issues, i)`. Commands without aliases render unchanged. The canonical name is styled while the alias suffix is plain so the canonical spelling stands out at a glance; column alignment is preserved using the ANSI-aware `padEnd` from `@crustjs/style`.

  `didYouMeanPlugin` includes aliases in its candidate list when matching against an unknown command, but always reports the canonical name in the `Did you mean "X"?` message. So a typo of an alias (`issuess` for `issues`) suggests the canonical (`issue`), and a candidate that matches both an alias and its canonical is deduplicated to a single canonical suggestion.

  Both behaviors require `aliases` on `CommandMeta`, added in the same release of `@crustjs/core`.

- b87e0ee: `helpPlugin` now omits subcommands marked `meta.hidden: true`.

  `formatCommandsSection` filters out subcommands whose `meta.hidden === true`
  before rendering the `COMMANDS:` block. If every subcommand is hidden, the
  section is omitted entirely (no orphan `COMMANDS:` heading). Insertion
  order of the surviving entries is preserved, and alias rendering composes
  correctly — a visible subcommand with aliases still renders as
  `name (alias1, alias2)`.

  Hidden filtering affects help output only. Hidden subcommands remain
  directly invocable by name; routing in `@crustjs/core` does not consult
  `meta.hidden`. This is intentional and load-bearing for internal
  runtime commands like the future `__complete` entrypoint used by
  shell-completion plugins.

  Requires `hidden` on `CommandMeta`, added in the same release of
  `@crustjs/core`.

- 70320f2: Renamed `autoCompletePlugin` to `didYouMeanPlugin`. The old export remains as a deprecated alias and will be removed in 1.0.0. The plugin's behavior is unchanged — it provides "did you mean?" command suggestion via Levenshtein matching, NOT shell tab completion.
- Updated dependencies [075490b]
- Updated dependencies [b87e0ee]
- Updated dependencies [f1baa45]
- Updated dependencies [075490b]
- Updated dependencies [8779692]
- Updated dependencies [82f5ad6]
- Updated dependencies [9db2613]
  - @crustjs/style@0.2.0
  - @crustjs/core@0.0.17

## 0.0.22

### Patch Changes

- df08a3a: Add NO_COLOR-aligned runtime color control.

  `@crustjs/style` now disables colors, but not non-color modifiers, when `NO_COLOR` is set to a non-empty value or when output is non-interactive in auto mode. The default exports also support runtime color overrides via `setGlobalColorMode()` and `getGlobalColorMode()`.

  `@crustjs/plugins` now includes `noColorPlugin()`, which adds `--color` and `--no-color` to a Crust CLI and applies the override for the current run.

  **Breaking:** The capability resolver exports have been renamed for symmetry with the new `resolveModifierCapability`:

  - `resolveCapability` → `resolveColorCapability`
  - `resolveTrueColor` → `resolveTrueColorCapability`

- Updated dependencies [df08a3a]
- Updated dependencies [df08a3a]
- Updated dependencies [67a9f25]
  - @crustjs/style@0.1.0

## 0.0.21

### Patch Changes

- Updated dependencies [def425e]
  - @crustjs/core@0.0.16

## 0.0.20

### Patch Changes

- 285ac24: Add colorful styling and defaults to help output

  - Style help output with ANSI colors for usage, sections, and tokens using `@crustjs/style`
  - Show default values for flags in help text
  - Display boolean negation flags (--no-<name>) for boolean options
  - Improve visual hierarchy with color-coded sections (usage in green, commands/options in cyan, required args in yellow)

- Updated dependencies [9b57c50]
  - @crustjs/style@0.0.6

## 0.0.19

### Patch Changes

- 5e0afa4: Fix inherited flags not being applied to subcommand trees injected by plugins. The help flag (`-h`) now correctly inherits into plugin-added subcommands.
- Updated dependencies [5e0afa4]
  - @crustjs/core@0.0.15

## 0.0.18

### Patch Changes

- 983204f: Add install-scope inference (`installScope` option, `UpdateNotifierInstallScope` type) and scope-aware upgrade commands to `updateNotifierPlugin`. Export `UpdateNotifierPackageManager` and `UpdateNotifierInstallScope` from the package entrypoint. The `updateCommand` callback now receives a third `installScope` argument (breaking for existing callbacks). Update notice output moved from stdout (`console.log`) to stderr (`process.stderr.write`).

## 0.0.17

### Patch Changes

- Updated dependencies [f78b327]
  - @crustjs/core@0.0.14

## 0.0.16

### Patch Changes

- d7bb1aa: Refactor `updateNotifierPlugin` options: make `packageName` required, remove `enabled` option, and move `intervalMs` into a new `cache` config object (`{ adapter, intervalMs? }`) to better co-locate cache-related settings.
- Updated dependencies [944f852]
- Updated dependencies [6dea64c]
  - @crustjs/style@0.0.5
  - @crustjs/core@0.0.13

## 0.0.15

### Patch Changes

- Updated dependencies [b8ebfa4]
  - @crustjs/core@0.0.12

## 0.0.14

### Patch Changes

- 7dc9ede: Simplify `UpdateNotifierCacheAdapter` by removing the unused `packageName` parameter from `read()` and `write()`, allowing `@crustjs/store` instances to be passed directly as the `cache` option.
- Updated dependencies [9f81bcc]
- Updated dependencies [72ea166]
  - @crustjs/core@0.0.11

## 0.0.13

### Patch Changes

- 1715c81: Style update notifier with a colored boxed notice using `@crustjs/style`

## 0.0.12

### Patch Changes

- 96ca6b2: Adopt the new builder-style command API across core and official packages, including inherited flags, lifecycle hooks, plugin usage, and command metadata improvements. Update related tooling, templates, and documentation to align with the new command authoring flow.
- Updated dependencies [96ca6b2]
  - @crustjs/core@0.0.10

## 0.0.11

### Patch Changes

- cae6ea2: Add `updateNotifierPlugin` to `@crustjs/plugins`. The plugin checks the npm registry for newer versions of your package and displays a non-blocking update notice after command execution. It is non-persistent by default, supports optional cache adapters (including `@crustjs/store`) for cross-run caching and dedupe, and uses package-manager-aware update commands with override support. Adopted in the `crust` CLI and the `create-crust` scaffold template by default.

## 0.0.10

### Patch Changes

- a1f233e: Enable minification for all package builds, reducing bundle sizes by ~27%. Also shorten error messages in `@crustjs/core` for smaller output.
- Updated dependencies [a1f233e]
- Updated dependencies [e3624b2]
  - @crustjs/core@0.0.9

## 0.0.9

### Patch Changes

- Updated dependencies [384e2a9]
  - @crustjs/core@0.0.8

## 0.0.8

### Patch Changes

- Updated dependencies [1364768]
  - @crustjs/core@0.0.7

## 0.0.7

### Patch Changes

- fe4d64d: Make `path` parameter optional in `renderHelp`, defaulting to `[command.meta.name]` for simpler usage

## 0.0.6

### Patch Changes

- Updated dependencies [8c23587]
  - @crustjs/core@0.0.6

## 0.0.5

### Patch Changes

- 8e0b48a: Fix published package metadata containing unresolved workspace and catalog protocols by switching to bun publish
- Updated dependencies [8e0b48a]
  - @crustjs/core@0.0.5

## 0.0.4

### Patch Changes

- dcc258c: switch to use literal string for flags and args types
- Updated dependencies [115d396]
- Updated dependencies [9b951e9]
- Updated dependencies [bdd101f]
- Updated dependencies [dcc258c]
  - @crustjs/core@0.0.4

## 0.0.3

### Patch Changes

- Update domain to crustjs.com, update dependencies, add homepage, and remove flaky cross-compilation tests
- Updated dependencies
  - @crustjs/core@0.0.3
