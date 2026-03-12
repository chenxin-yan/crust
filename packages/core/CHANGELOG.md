# @crustjs/core

## 0.0.14

### Patch Changes

- f78b327: Decouple parsing from validation: `parseArgs()` is now a pure parse+coerce function that never throws for missing required values. A new `validateParsed()` function handles required-value constraints separately. This fixes `--help` showing an error instead of help text when required args are missing.

## 0.0.13

### Patch Changes

- 6dea64c: Handle Ctrl+C prompt cancellations more gracefully. Prompt rendering now moves to a fresh line on cancel, and `Crust.execute()` treats `CancelledError` as a silent user abort with exit code `130` instead of printing `Error: Prompt was cancelled.`.

## 0.0.12

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

## 0.0.11

### Patch Changes

- 9f81bcc: Preserve effective flag typing across `Crust` builder chains by carrying an internal `Eff` generic, and short-circuit `EffectiveFlags` for wide inherited flag types to reduce TypeScript type-check overhead.
- 72ea166: Reduce TypeScript type-check overhead in large projects by removing compile-time inherited/local flag cross-collision validation from `Crust#flags()`. Runtime collision checks remain in argument parsing and command-tree validation.

## 0.0.10

### Patch Changes

- 96ca6b2: Adopt the new builder-style command API across core and official packages, including inherited flags, lifecycle hooks, plugin usage, and command metadata improvements. Update related tooling, templates, and documentation to align with the new command authoring flow.

## 0.0.9

### Patch Changes

- a1f233e: Enable minification for all package builds, reducing bundle sizes by ~27%. Also shorten error messages in `@crustjs/core` for smaller output.
- e3624b2: Add pre-compile validation to `crust build`. Before compiling, the build command now spawns your entry file in a validation-only subprocess to check the full command tree (including plugin-injected flags and subcommands) for definition errors such as flag alias collisions and reserved `no-` prefix misuse. Disable with `--no-validate`.

## 0.0.8

### Patch Changes

- 384e2a9: Add `addSubCommand` to plugin `SetupActions`, allowing plugins to inject subcommands during setup. User-defined subcommands take priority over plugin-injected ones. `Command.subCommands` is now always initialized (non-optional).

  Redesign `@crustjs/skills` from a build-time CLI tool into a runtime plugin. `skillPlugin()` handles auto-update of installed skills and optionally registers an interactive `skill` subcommand via `addSubCommand`. Skill metadata (name, description) is derived from the root command — only `version` needs to be supplied. Remove `createSkillCommand` and `SkillCommandOptions` from public API.

## 0.0.7

### Patch Changes

- 1364768: Harden boolean flag parsing by reserving the `no-` prefix for canonical negation only: reject `no-`-prefixed flag names/aliases at definition time, disallow `--no-<alias>` in favor of `--no-<canonical>`, and return clearer parse errors for invalid boolean value assignment forms like `--flag=true`.

## 0.0.6

### Patch Changes

- 8c23587: Add `@crustjs/validate` package with Zod 4 and Effect schema-first validation for CLI commands.

  `defineZodCommand` uses Zod schemas as the single source of truth — parser definitions, help text, runtime validation, and handler types are all derived from the schemas. Includes `arg()` and `flag()` DSL helpers, compile-time variadic/alias validation, and structured `CrustError("VALIDATION")` errors.

  Core changes: export `ValidateFlagAliases` and `ValidateVariadicArgs` utilities, add `ValidationErrorDetails` type to `VALIDATION` error code, and generalize compile-time validation types to work with any record/tuple shape.

## 0.0.5

### Patch Changes

- 8e0b48a: Fix published package metadata containing unresolved workspace and catalog protocols by switching to bun publish

## 0.0.4

### Patch Changes

- 115d396: revamp type system for args and flags for better UX when working with defineCommand
- 9b951e9: fix alias collision error message to use correct prefix for multi-letter aliases
- bdd101f: improve compile-time validation errors to show per-item granularity with descriptive branded properties
- dcc258c: switch to use literal string for flags and args types

## 0.0.3

### Patch Changes

- Update domain to crustjs.com, update dependencies, add homepage, and remove flaky cross-compilation tests
