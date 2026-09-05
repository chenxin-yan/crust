# @crustjs/plugins

## 0.2.0

### Minor Changes

- [#342](https://github.com/chenxin-yan/crust/pull/342) [`9d66c8f`](https://github.com/chenxin-yan/crust/commit/9d66c8f569c407dc10c61b5b0bc20e05a1ba83c7) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - `completion()` contributes a build hook: `crust build` writes `<outdir>/completions/<bin>`, `_<bin>`, and `<bin>.fish`, and `crust build --package` stages the directory in the root npm package. Export `renderBashCompletion()`, `renderZshCompletion()`, `renderFishCompletion()`, and `CompletionRenderOptions` for custom pipelines. `binName` applies to both the runtime command and the build hook. All paths use the root command's version unless explicitly overridden, and require a version to be present. The build hook stages all scripts before replacing previous artifacts, preserving them if validation, rendering, or staging writes fail.

- [`cc466b5`](https://github.com/chenxin-yan/crust/commit/cc466b5a0b5792d4811e85d82e341980bc1fb606) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Ship the 0.2 API revamp for the framework spine (see `docs/adr/`). This is a hard cut from the 0.1 API with no compatibility shims; each removed name's replacement is listed below.
  
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
  
  **Parser and routing**
  
  - Boolean negation is alias-symmetric: `--no-<alias>` works for every long alias, matching man pages and completion scripts. `noNegate: true` is enforced by the parser — negating a `noNegate` boolean via any spelling is a `PARSE` error instead of being silently accepted.
  - Routing skips known flags and their values before a subcommand name, so `app --quiet translate` runs `translate` instead of silently resolving the actionless root and exiting 0. It recognizes every parser-accepted spelling: long names, `--flag=value`, permitted `--no-<name>` negation, short flags and inline values, long aliases, and bundled short booleans. Unknown flags and the `--` terminator still stop routing.
  - Recursive flags before a subcommand bind to the subcommand invocation, so `app --help sub` shows the child's help. A pre-subcommand flag the routed child cannot parse now fails during routing with an actionable `PARSE` error (`Flag "--quiet" cannot be used before subcommand "sub" because "sub" does not accept it.`) instead of an unknown-flag error or silent no-op. Propagating Context-owned and recursive Extension flags continue routing through.
  - Argv tokens matching inherited `Object.prototype` keys, such as `mycli constructor` and `mycli __proto__`, report `COMMAND_NOT_FOUND` instead of crashing; typed `run()` positional and flag lookups no longer resolve inherited keys.
  
  **Definition validation**
  
  - Compile-time `FIX_*` brands own statically checkable mistakes: variadic placement, flag defaults outside literal `choices` (`FIX_DEFAULT_CHOICE`), spelling/name/alias collisions, empty flag spellings and command/argument names, reserved `__proto__` spellings, `no-` prefixes, schema exclusivity, parser synchronicity, section audience exclusivity, and dependency closure — consistently across `.flags()`, `.args()`, `.add()`, `.provide()`, `.extend()`, `defineContext`, and `defineExtension`.
  - `defineExtension()` flags are authored as a readonly array of named definitions, matching `.flags()` and `defineContext()`. Statically known Extension command collisions within one Extension tuple, with authored commands, or with other Extensions are rejected with `FIX_COMMAND_COLLISION`; flag collisions against application flags and earlier Extensions use `FIX_ALIAS_COLLISION`.
  - Dynamically assembled definitions — including config-built flags, args, commands, and Extensions — fail loudly with `DEFINITION` errors at the same composition points instead of silently misbehaving. Runtime otherwise validates only what types cannot see: argv values, dynamic strings, recipe behavior, and transitive dependencies above an `.of()` cut.
  
  **Typed run and execute**
  
  - `run(path, input?, io?)` infers command paths, arguments, and flags from the application definition while exercising the normal argv parser pipeline. Raw argv invocation remains available through `execute()`, which accepts an optional `io` override alongside `argv`.
  
  ```ts
  const outcome = await app.run(["remote", "add"], {
    args: { name: "origin" },
    flags: { fetch: true },
  });
  if (outcome.status === "completed") console.log(outcome.result);
  ```
  
  - `run()` resolves to a `RunOutcome` discriminated union: `completed` owns the selected action's typed `result`, while `finished` owns the identity of the Extension whose `preRun` hook ended the invocation.
  - Statically declared Extension commands and flags merge into typed `run()` paths and inputs; widened, conditionally assembled, or variable-length contributions remain runtime-only. Extension-owned flag values are inferred in `defineExtension()` hook contexts; command-specific flags remain `unknown`, and root-only flags include `undefined`.
  - String flags and args with literal `choices` narrow to their value union: `{ type: "string", choices: ["staging", "production"] as const }` infers `"staging" | "production"`. Widened `readonly string[]` choices still infer `string`, and `parse` still owns the output type when present.
  - Syntax-parsed input is typed separately from schema-validated action input. Typed `run()` JSON values — including named object interfaces, readonly arrays, and tuples — are constrained to recursively JSON-compatible data.
  
  **Tooling snapshots and documentation sections**
  
  - Tooling snapshots expose parser-derived flag-negation and command-listing policy. Section-listing helpers move from `@crustjs/core` to `@crustjs/core/tooling`, and the internal `Simplify` type is no longer exported.
  - Commands can define plain-text `meta.sections`, and Extensions can append sections to canonical command paths during application preparation. Help and man-page output render merged per-command sections after built-in content; generated man pages also include sections from visible subcommands.
  - Sections are visible to every renderer by default; `only` and `except` select audiences. Audiences accept Extension and renderer factory objects directly (`only: [skill]`), branded `ExtensionId` values from `defineExtensionId()` for custom renderers, and official identities on factory statics (`help.id`, `man.id`, `skill.id`). The `crust:*` id namespace is reserved for official Extensions.
  - Extensions are identified by branded ids, for example `defineExtension(defineExtensionId("acme:feature"), config)`, and expose that identity as `.id`. Handled `execute()` failures are attributed through `InvocationOutcome.by`; compare it with a factory static such as `outcome.by === help.id`. Core fallback rendering leaves `outcome.by` undefined.
  - For `execute()` failures reached during dispatch, `onError` settles before `postRun`. Invocation Contexts remain pullable through `onError` and `postRun` before disposal.
  - Application-authored "Agent skills" sections are preserved in generated skills.

- [#345](https://github.com/chenxin-yan/crust/pull/345) [`6afef3d`](https://github.com/chenxin-yan/crust/commit/6afef3d3ca04bd941507298d074d1b54a775c54a) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Require a caret-compatible version of @crustjs/core in official package peers. Packed peer ranges now start at the versioned workspace core instead of accepting all 0.x releases, excluding older incompatible core APIs.

- [#335](https://github.com/chenxin-yan/crust/pull/335) [`8ee2946`](https://github.com/chenxin-yan/crust/commit/8ee2946af57574bbd497104cda70dedf34e095b8) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Add command sections to the shared documentation model and export `formatDefault` from `@crustjs/core/tooling`. Root command metadata now carries the application version so version, completion, update-notifier, and skill generation can use one source of truth while extension options remain overrides; reusable command configs reject root-only version metadata. Skill link-operation results now report their effective scope.

- [`cc466b5`](https://github.com/chenxin-yan/crust/commit/cc466b5a0b5792d4811e85d82e341980bc1fb606) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Introduce `@crustjs/extensions`, the official Extension collection succeeding `@crustjs/plugins`. All Extensions are imported from the package root:
  
  - `help()` renders command help, including long flag aliases (`-o, --output, --out`); negation is shown for the canonical name only.
  - `version(value, options?)` prints the application version. The `format` option controls output: `"plain"` prints the bare version, or a `(version, context) => string` function customizes the line; default output is `<name> v<version>`.
  - `completion()` generates completion scripts; output directories always include every supported shell.
  - `didYouMean()` suggests near-miss commands.
  - `noColor()` adds `--color`/`--no-color`, scoping the standard `FORCE_COLOR`/`NO_COLOR` environment variables around command execution — `--color` sets `FORCE_COLOR=3` (clearing `NO_COLOR`), `--no-color` sets `NO_COLOR=1` (clearing `FORCE_COLOR`), and prior values are restored after the run — so child processes and other color-aware libraries comply too.
  - `updateNotifier()` checks for newer releases using Bun's SemVer precedence, including notifying prerelease users when a matching stable release lands. Persistence is on by default through a lazily loaded `@crustjs/store` cache at `stateDir(packageName)`; set `cache: false` to opt out, `cache: { intervalMs }` to tune it, or provide a custom adapter. A corrupt cache file is treated as empty and repaired after the next successful check.
  - Update notices are command-less by default. Configure the single `updateCommand` option with a string, a callback receiving `{ packageName, packageManager }`, or `{ scope: "global" | "local" }` for an automatically generated package-manager command; notices can instead link to update documentation. The separate `packageManager` and `installScope` options and `UpdateNotifierInstallScope` export are removed.
  - Completion and typo suggestions consume Core's shared flag-negation and command-listing policies.
  
  `@crustjs/extensions` has a runtime dependency on `@crustjs/store`.

- [#307](https://github.com/chenxin-yan/crust/pull/307) [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Modernize the runtime support matrix and package builds.
  
  - Supported runtimes: Bun 1.3.14+, Node.js 22+, and Deno 2.8+. Package runtime code is portable across all three — Bun globals are replaced with Node-compatible built-ins, and process spawning uses `node:child_process`. On runtimes without `AsyncDisposableStack` (Node 22/23), invocations fall back to an in-package disposal stack.
  - Package builds migrate to tsdown (Rolldown) and modules are marked side-effect free. Internal `@crustjs/utils` imports are inlined, fixing `@crustjs/store` installs that previously required `@crustjs/utils` at runtime. Consumers bundling with Bun 1.3.10–1.3.13 may encounter oven-sh/bun#27709 when tree-shaking packages with `sideEffects: false`.
  - All packages that ship type declarations declare an optional `typescript: "^7.0.0"` peerDependency. Builder inference performance is measured and supported against the native TypeScript 7 compiler; plain-JavaScript consumers are unaffected.

### Patch Changes

- [#337](https://github.com/chenxin-yan/crust/pull/337) [`8e9fe39`](https://github.com/chenxin-yan/crust/commit/8e9fe3996832f0e6327bead3e82888d58df6201a) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Expose and document the public types needed to name existing API signatures. `Crust._types` is now a supported type-level seam for accessing an application's inferred command types.

- [#332](https://github.com/chenxin-yan/crust/pull/332) [`65b6686`](https://github.com/chenxin-yan/crust/commit/65b66866b360cf07610be5a2f52c5dce46d70dbe) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Exclude hidden commands from `COMMAND_NOT_FOUND` details and rely on that core contract when rendering did-you-mean errors.

- [#307](https://github.com/chenxin-yan/crust/pull/307) [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Faster startup and type-checking.
  
  - Core reuses its prepared invocation tree across repeated dispatches, and skill implementation modules are deferred until first use. Extension command recipes materialize once per builder instance instead of on every run — recipes must stay inert, per the documented contract.
  - Long `.flags()` chains hit `TS2589` about 3x later, the `.provide()` chain ceiling is removed, and `ctx` inference no longer silently degrades on long `.provide()` chains.
- Updated dependencies [[`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce), [`3526708`](https://github.com/chenxin-yan/crust/commit/3526708b3e95c214c4142c31caa106f845bd2fa4), [`cc466b5`](https://github.com/chenxin-yan/crust/commit/cc466b5a0b5792d4811e85d82e341980bc1fb606), [`6ce23e2`](https://github.com/chenxin-yan/crust/commit/6ce23e239b61777ffd29feb2458e23afc546953c), [`40241e2`](https://github.com/chenxin-yan/crust/commit/40241e2e7ecf80a5524a5a6abc1e603ba81ae1b4), [`8ee2946`](https://github.com/chenxin-yan/crust/commit/8ee2946af57574bbd497104cda70dedf34e095b8), [`8e9fe39`](https://github.com/chenxin-yan/crust/commit/8e9fe3996832f0e6327bead3e82888d58df6201a), [`85d7aa4`](https://github.com/chenxin-yan/crust/commit/85d7aa4ee5010f82622ca6f0d9e81e85f99255ee), [`85d7aa4`](https://github.com/chenxin-yan/crust/commit/85d7aa4ee5010f82622ca6f0d9e81e85f99255ee), [`65b6686`](https://github.com/chenxin-yan/crust/commit/65b66866b360cf07610be5a2f52c5dce46d70dbe), [`948ae46`](https://github.com/chenxin-yan/crust/commit/948ae465650e815d26f9f1edac104c1206763a4d), [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce), [`38aac0c`](https://github.com/chenxin-yan/crust/commit/38aac0cb804c300864f37dacea460c3daf0cef29), [`11f6e26`](https://github.com/chenxin-yan/crust/commit/11f6e261e08367d9f1b36f47ed52d0646ebe9903), [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce), [`8e9fe39`](https://github.com/chenxin-yan/crust/commit/8e9fe3996832f0e6327bead3e82888d58df6201a), [`11f6e26`](https://github.com/chenxin-yan/crust/commit/11f6e261e08367d9f1b36f47ed52d0646ebe9903), [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce), [`3526708`](https://github.com/chenxin-yan/crust/commit/3526708b3e95c214c4142c31caa106f845bd2fa4), [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce), [`58fd65d`](https://github.com/chenxin-yan/crust/commit/58fd65d8efcba8dcad4652d11abb2bef62f32da9)]:
  - @crustjs/core@0.2.0
  - @crustjs/store@0.3.0
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
