# @crustjs/core

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
