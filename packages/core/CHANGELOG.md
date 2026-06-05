# @crustjs/core

## 0.0.18

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

- d08439a: Internal refactor: `ValueType`, `ResolvePrimitive`, and number coercion now use shared `@crustjs/utils` primitives with no consumer-visible behavior change.
- c4d2b22: Extend `ValueType` with `"url"`, `"path"`, and `"json"` (resolving to `URL`, absolute `string`, and `unknown`). Add a `parse?: (raw: string) => unknown` escape hatch on `StringFlagDef`/`StringMultiFlagDef`/`StringArgDef`; every non-string variant declares `parse?: never`, so misuse is rejected at compile time. Async `parse` functions are rejected at command setup via a new `CONFIG` error code. Fix: when `parse` is set and argv is absent but `default` is present, `parse(String(default))` now runs so the runtime value matches the inferred type. **Behavior change:** `choices` on string flags/args is now enforced at parse time (previously hint-only); raw argv is validated against `choices` before any `parse` transform runs.
- c4d2b22: Review-driven follow-ups to the value-type and parse-escape-hatch work:
  - `type: "path"` flag/arg defaults now run through `coercePath` so omitting the flag yields the same absolute path users get when they pass it on the command line (`{ type: "path", default: "./dist" }` previously returned the raw relative string).
  - `choices` is now validated against `default` values in both the parse and non-parse default branches, mirroring argv-side enforcement so `{ choices: ["a","b"], default: "z" }` can't be silently accepted while `--flag z` throws.
  - Re-export the documented `Resolve<T>` and `ResolveBaseType<F>` type helpers from `@crustjs/core` so consumers can `import type { Resolve, ResolveBaseType } from "@crustjs/core"` as the API reference shows.

- Updated dependencies [0dc69b1]
- Updated dependencies [d08439a]
  - @crustjs/utils@0.0.2

## 0.0.17

### Patch Changes

- b87e0ee: Add `choices` to `FlagDef`/`ArgDef` and `hidden` to `CommandMeta`.

  Two purely-additive optional fields on the `@crustjs/core` public type surface:
  - **`choices?: readonly string[]`** on string-typed flag and arg variants
    (`StringFlagDef`, `StringMultiFlagDef`, `StringArgDef`) — a static enum of
    valid values for the flag/arg.

    ```ts
    flags: {
      target: { type: "string", choices: ["browser", "bun", "node"] },
    }
    ```

    `choices` is a **hint for tooling** consumed by shell-completion tooling
    to emit static value candidates and may be consumed by future opt-in
    validation. It is **NOT** enforced at parse time in this version: passing
    a value outside `choices` does not throw, the value is still parsed as a
    string and delivered to your handler. Validate explicitly inside your
    handler if you need runtime rejection today. Adding `choices` to
    number/boolean variants is a compile-time error.

  - **`hidden?: boolean`** on `CommandMeta` — omits a command from any
    tooling that enumerates the command tree for users (help output, man
    pages, skill descriptors, completion candidate lists, etc.).

    ```ts
    meta: { name: "__complete", hidden: true, description: "Internal" }
    ```

    Listing-only: the command stays fully invocable by name (or alias),
    routing is unchanged, and it can still surface through tooling that
    looks up specific commands rather than enumerating the tree (e.g.
    `didYouMeanPlugin`). The default `helpPlugin` (in `@crustjs/plugins`)
    follows this contract today; first-party generators and custom
    renderers should too.

  Both fields are purely additive at the type level — existing code that
  does not set `choices` or `hidden` is unchanged. The parser is
  unmodified.

- f1baa45: Add `aliases` to `CommandMeta`.

  Commands and subcommands can now declare alternative names that resolve to the same command node:

  ```ts
  new Crust("my-cli").command("issue", (cmd) =>
  	cmd.meta({ aliases: ["issues", "i"] }).run(() => {}),
  );
  // my-cli issue, my-cli issues, and my-cli i all route to the same command
  ```

  The change is purely additive at the type level — existing code that does not set `aliases` is unchanged. `resolveCommand` gains a fast path that scans sibling `meta.aliases` on miss; `commandPath` continues to record the canonical name only, so error messages, help titles, and downstream plugins are unaffected by which alias the user typed. `CrustError("COMMAND_NOT_FOUND")`'s `details.available` keeps its canonical-only contract — alias-aware consumers (e.g. `didYouMeanPlugin`) read aliases directly from `details.parentCommand.subCommands`.

  Alias collisions are eagerly rejected at registration time with `CrustError("DEFINITION", …)`. Plugin-installed subcommands (via the `addCommand` setup action) get the same check and are skipped with a warning if their canonical name or any alias collides — mirroring how a colliding canonical name was already handled. `validateCommandTree` re-runs the full check against the final tree. An alias may not equal the command's own canonical name, any sibling's canonical name, or any sibling's alias; aliases must be non-empty, contain no whitespace, and not start with `-`.

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

- 9db2613: Make build-validation mode safe for in-process callers.

  `Crust.execute()` no longer calls `process.exit()` when only
  `CRUST_INTERNAL_VALIDATE_ONLY=1` is set — it now runs the validation
  pipeline, surfaces errors via stderr and `process.exitCode`, and returns
  like the rest of `.execute()`'s error paths. Process termination is
  opt-in via the new `CRUST_INTERNAL_VALIDATE_FORCE_EXIT=1` env var, which
  `crust build`'s `validateEntrypoint()` sets on its spawned subprocess.

  For end users there is no change: `crust build` now sets both env vars on
  its validation subprocess, preserving the existing behavior of skipping
  entrypoint code after `await app.execute()` during the build check.
  Tests and embedders that need to exercise the validation pipeline can
  now do so without being terminated.

## 0.0.16

### Patch Changes

- def425e: Restrict `noNegate` to boolean flag types only

  Moved `noNegate` from the shared `FlagDefBase` interface to `BooleanFlagDef` and `BooleanMultiFlagDef`. Setting `noNegate` on a non-boolean flag (e.g. string or number) is now a compile-time error instead of being silently ignored at runtime.

## 0.0.15

### Patch Changes

- 5e0afa4: Fix inherited flags not being applied to subcommand trees injected by plugins. The help flag (`-h`) now correctly inherits into plugin-added subcommands.

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
