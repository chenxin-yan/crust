# @crustjs/man

## 0.2.0

### Minor Changes

- [#139](https://github.com/chenxin-yan/crust/pull/139) [`0ce45f4`](https://github.com/chenxin-yan/crust/commit/0ce45f4cd41cc4c9ef4181a23ea6360fd756b49b) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Ship the 0.2 API revamp for the framework spine (see `docs/adr/`). This is a hard cut from the 0.1 API with no compatibility shims; each removed name's replacement is listed below.
  
  - **Extensions replace plugins**: `defineExtension(id, config)` in `@crustjs/core` (ids minted by `defineExtensionId()`) returns a plain frozen config; `.use()` is removed. Extension behavior lives in named `hooks` — `preRun(ctx)` (return `ctx.finish()` to short-circuit successfully), `postRun(ctx, outcome)` (runs in reverse extension order after every settled invocation), and `onError(error, ctx)` (return `true` after rendering an `execute()` failure). Extension-contributed commands are `defineCommand()` definitions (`ExtensionCommand` is removed), and `execute()` offers `AbortError` cancellation to `onError` hooks for central rendering (exit code stays `130`, silent when unclaimed).
  - **`define*` helpers name every definition**: `defineCommand`, `defineContext`, `defineExtension`, `defineFlag`, `defineArg`. Builder methods are variadic and accumulative — `.flags(...defs)` replaces `.flags(record)`, `.args(...defs)` replaces `.args(tuple)` — with statically known duplicate names, spellings, and aliases rejected at compile time through `FIX_*` brands. Runtime checks remain for dynamic command-recipe behavior, Context dependencies, documentation sections, and argv input. Repeating `.action()` replaces the prior action.
  - **Commands are inert reusable definitions**: `defineCommand(name, { description, usage, aliases, hidden }, recipe)` attached with the checked variadic `.add(...definitions)`; use `.as(newName)` to reuse one definition under multiple names. `.sub()`, `.command()`, `.meta()`, and `ChildCrust` are removed; root metadata moves to `new Crust(name, { description, usage })`.
  - **Contexts are declared lazy command dependencies**: `defineContext(name, { flags?, uses? }, setup)` returns a factory attached with `.provide(...instances)` and consumed through lazy `ctx` properties. Contexts, reusable commands, and Extensions declare dependencies with `uses`; composition sites check the graph. Context-owned flags are the only flag-propagation mechanism (`FlagDef.inherit` and `FlagSnapshot.inherit` are removed); `.of(value)` creates dependency-free test doubles; Context values are disposed via `Symbol.dispose`/`Symbol.asyncDispose` in reverse construction order.
  - **Actions and execution**: `.action(action)` replaces `.handle()` and defines the Command Action; `.run(path, input, { stdout, stderr })` throws for programmatic embedding; `.execute()` renders and sets `process.exitCode`. Builder-level `preRun`/`postRun` are removed — lifecycle work moves to Extension hooks.
  - **Errors**: `CrustError` keeps four stable codes (`DEFINITION`, `PARSE`, `VALIDATION`, `COMMAND_NOT_FOUND`); `_tag`, `CONFIG`, and `EXECUTION` are removed; action and Context errors pass through unwrapped.
  - **Validation**: Standard Schema is supported directly on arg/flag definitions; `@crustjs/validate` is removed.
  - **Tooling**: `Crust.snapshot()` is the supported API for frozen, validated Command Snapshots; public `CommandNode`/`prepareCommandTree()` are removed, and man/crust/skills render help, man pages, and Agent Skills from one shared command documentation model.
  - **Generics**: the generic parameters on `Crust`, `CommandDefinitionBuilder`, and the Context types were reordered and re-purposed; prefer inference over positional annotations.
  - `create-crust` ships a single minimal template.

- [#307](https://github.com/chenxin-yan/crust/pull/307) [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Unify build-time artifact generation behind Extension build hooks and a single snapshot protocol.
  
  - Extensions can expose a `build(ctx)` hook for build-time artifact generation. The context carries the frozen root Command Snapshot and a resolved absolute output directory; snapshots are refreshed between hooks so later generators see sections derived from earlier hooks' outputs.
  - `crust build` runs build hooks from every registered Extension in registration order. Extension presence is the source of intent — the `--man` flag is removed, and `--no-validate` is the single opt-out that skips entry preparation and all build hooks. npm package staging includes every top-level artifact directory emitted by hooks; the name `bin` is reserved for the generated npm executables.
  - Build validation and artifact generation share one subprocess-only snapshot-file protocol. `@crustjs/core/tooling` exports `SNAPSHOT_PATH_ENV` (replacing `VALIDATION_MODE_ENV` and `VALIDATION_FORCE_EXIT_ENV`), and man-page generation no longer requires the entry module to export its app. Entries that never call `await app.execute()` previously passed validation vacuously; they now fail with an actionable missing-snapshot error (use `--no-validate` if intentional).
  - New `man(options?)` in `@crustjs/man`: a build-only Extension that writes an mdoc page under the build output's `man` directory. Section 1 is the default; `man({ section })` selects another section and `man({ name })` sets the installed command name. `writeManPage()` remains for custom pipelines and now accepts a prepared Command Snapshot as `root` instead of a live app.
  - The `skill()` Extension in `@crustjs/skills` contributes a build hook that writes packaged skills under the build output's `skills` directory: it copies an available packaged source wholesale and otherwise renders from the prepared Command Snapshot.

- [#307](https://github.com/chenxin-yan/crust/pull/307) [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Add a shared documentation-section model with audience filtering.
  
  - Commands can define plain-text `meta.sections`, and Extensions can append sections to canonical command paths during application preparation. Help and man-page output render the merged per-command sections after their built-in content, and generated man pages include sections from visible subcommands.
  - Sections are visible to every renderer by default; `only` and `except` select audiences. Audiences accept Extension and renderer factory objects directly (`only: [skill]`), branded `ExtensionId` values minted by `defineExtensionId()` for custom renderers, and official renderer identities on factory statics (`help.id`, `man.id`, `skill.id`). The `crust:*` id namespace is reserved for official Extensions.
  - Extensions are identified by branded ids: `defineExtension(defineExtensionId("acme:feature"), config)` — and expose that identity as `.id`. Handled `execute()` failures are attributed through `InvocationOutcome.by`; compare with factory statics, e.g. `outcome.by === help.id`. Core fallback rendering leaves `outcome.by` undefined.
  - For `execute()` failures reached during dispatch, `onError` now settles before `postRun`. Invocation Contexts remain pullable through `onError` and `postRun` before disposal.
  - Application-authored "Agent skills" sections are preserved in generated skills.

- [#307](https://github.com/chenxin-yan/crust/pull/307) [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Modernize the runtime support matrix and package builds.
  
  - Supported runtimes: Bun 1.3.14+, Node.js 22+, and Deno 2.8+. Package runtime code is portable across all three — Bun globals are replaced with Node-compatible built-ins, and process spawning uses `node:child_process`. On runtimes without `AsyncDisposableStack` (Node 22/23), invocations fall back to an in-package disposal stack.
  - Package builds migrate to tsdown (Rolldown) and modules are marked side-effect free. Internal `@crustjs/utils` imports are inlined, fixing `@crustjs/store` installs that previously required `@crustjs/utils` at runtime. Consumers bundling with Bun 1.3.10–1.3.13 may encounter oven-sh/bun#27709 when tree-shaking packages with `sideEffects: false`.
  - All packages that ship type declarations declare an optional `typescript: "^7.0.0"` peerDependency. Builder inference performance is measured and supported against the native TypeScript 7 compiler; plain-JavaScript consumers are unaffected.

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
