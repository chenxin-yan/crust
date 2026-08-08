# @crustjs/man

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

- [#139](https://github.com/chenxin-yan/crust/pull/139) [`0ce45f4`](https://github.com/chenxin-yan/crust/commit/0ce45f4cd41cc4c9ef4181a23ea6360fd756b49b) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Require Bun 1.3.14 or newer across all published packages and remove the obsolete sync-disposal workaround now that `AsyncDisposableStack.use()` supports `Symbol.dispose`.

### Patch Changes

- [#139](https://github.com/chenxin-yan/crust/pull/139) [`0ce45f4`](https://github.com/chenxin-yan/crust/commit/0ce45f4cd41cc4c9ef4181a23ea6360fd756b49b) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Documentation consolidation: package READMEs are now concise stubs linking to the docs site (crustjs.com), unique README content moved into the docs, and public option/type TSDoc was enriched (descriptions, `@default` tags) to back generated API reference tables. No runtime behavior changes.

- [#139](https://github.com/chenxin-yan/crust/pull/139) [`0ce45f4`](https://github.com/chenxin-yan/crust/commit/0ce45f4cd41cc4c9ef4181a23ea6360fd756b49b) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Deduplicate prompt internals, remove the unused progress `getTheme` export, and simplify spinner and man-page rendering.

## 0.1.2

### Patch Changes

- @crustjs/core@0.0.19

## 0.1.1

### Patch Changes

- Updated dependencies [0dc69b1]
- Updated dependencies [d08439a]
- Updated dependencies [c4d2b22]
- Updated dependencies [c4d2b22]
  - @crustjs/core@0.0.18

## 0.1.0

### Minor Changes

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

- f1baa45: `mdoc` includes command aliases in the SUBCOMMANDS section.

  When a subcommand declares `aliases` on its `meta`, the rendered man page lists them inline next to the canonical name on the `.It Nm` line — e.g. `.It Nm issue (issues, i)` — matching the inline format used by `helpPlugin`. Subcommands without aliases render unchanged. The `.Bl -tag -width` directive's column width is recalculated to fit the longest combined label so alignment stays consistent.

  Requires `aliases` on `CommandMeta`, added in the same release of `@crustjs/core`.

- Updated dependencies [b87e0ee]
- Updated dependencies [f1baa45]
- Updated dependencies [8779692]
- Updated dependencies [9db2613]
  - @crustjs/core@0.0.17

## 0.0.2

### Patch Changes

- Updated dependencies [def425e]
  - @crustjs/core@0.0.16
