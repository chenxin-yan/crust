# @crustjs/plugins

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
