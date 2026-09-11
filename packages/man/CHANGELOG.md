# @crustjs/man

## 0.2.0

### Minor Changes

- [#307](https://github.com/chenxin-yan/crust/pull/307) [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Extension build hooks, multi-runtime builds, and snapshot-based man pages.
  
  - `crust build` runs registered Extension build hooks in registration order, refreshing the root snapshot between hooks. `--no-validate` skips entry preparation and all hooks. Entries that never reach `await app.execute()` now fail with a missing-snapshot error instead of passing validation vacuously; use `--no-validate` if intentional.
  - Choose Bun, Deno, or Node with `--runtime` or package.json's `crust.runtime`. Deno produces standalone executables with all permissions (`-A`); `--package`, `--minify`, and `--env-file` are unsupported. Node produces one executable JavaScript bundle with a Node shebang; `--target` and `--package` are unsupported.
  - `--target` requires canonical compiler names. Replace `linux-x64`/`darwin-arm64` with `bun-linux-x64-baseline`/`bun-darwin-arm64`; Deno uses triples such as `aarch64-apple-darwin`. Unknown targets suggest canonical spellings.
  - `crust build --package` stages every top-level artifact directory emitted by hooks; `bin` is reserved for npm executables. License copying selects the first existing `LICENSE`, `LICENSE.md`, `LICENCE`, or `LICENCE.md`, including it in root and platform packages.
  - Windows `.cmd`/`.bat` subprocess shims run through the platform shell, allowing builds under Node's CVE-2024-27980 hardening.
  - `@crustjs/man` adds the build-only `man(options?)` Extension and `ManOptions`. It writes `<outdir>/man/<name>.<section>`; section defaults to 1, with `name`/`section` overrides. For custom pipelines, migrate `writeManPage({ app, ... })` to `writeManPage({ root: await app.snapshot(), ... })`; `argv` and `logWarnings` options are removed. `renderManPageMdoc()` now takes a `CommandSnapshot` as `root` instead of `CommandNode`.

- [#345](https://github.com/chenxin-yan/crust/pull/345) [`6afef3d`](https://github.com/chenxin-yan/crust/commit/6afef3d3ca04bd941507298d074d1b54a775c54a) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Official Extensions require a caret-compatible `@crustjs/core` peer (`^0.2.0` for this release), excluding older incompatible core APIs rather than accepting all 0.x versions.

- [#307](https://github.com/chenxin-yan/crust/pull/307) [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Update runtime compatibility and package builds.
  
  - Libraries support Bun 1.3.14+, Node.js 22+, and Deno 2.8+ (`engines` updated). Context disposal includes a fallback for runtimes without `AsyncDisposableStack`, including Node 22/23. The `crust` build CLI remains Bun tooling; its npm distribution ships standalone executables with Bun embedded.
  - Published packages no longer depend on `@crustjs/utils`; its helpers are bundled. `@crustjs/store` also drops `@standard-schema/spec`. Library packages and `create-crust` are marked `sideEffects: false` for bundlers.
  - Packages shipping declarations declare an optional TypeScript `^7.0.0` peer; builder inference is supported on TypeScript 7. JavaScript consumers are unaffected by this compiler requirement.

### Patch Changes

- [#360](https://github.com/chenxin-yan/crust/pull/360) [`0b0aeca`](https://github.com/chenxin-yan/crust/commit/0b0aecaed104b6ee548ae01f589c71c44a2eb9bc) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Attribute files returned by Extension build hooks to their Extension ids, transport the Build Report to `crust build`, and print a concise per-hook artifact summary before compilation.

- [#355](https://github.com/chenxin-yan/crust/pull/355) [`7d72b4c`](https://github.com/chenxin-yan/crust/commit/7d72b4cfd235517e941e9384516a80f8dfa74e95) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Default `ExtensionFactory` dependency, provider, flag, and command parameters to closed contribution sets. Published factories can now omit empty trailing type arguments; explicitly use the broad upper-bound type for namespaces that must remain open.

- [#355](https://github.com/chenxin-yan/crust/pull/355) [`7d72b4c`](https://github.com/chenxin-yan/crust/commit/7d72b4cfd235517e941e9384516a80f8dfa74e95) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Automatically validate observable constraints at authoring, preparation, deferred definition consumption, and invocation. Dynamic names and collections use the same APIs; spread collections into variadic builder methods. Consume deferred Extension factory/section results when produced and verify declared Context availability without constructing Contexts.
  
  Keep known invocation contracts strict: literal choices, required fields, supplied positional prefixes, nonempty required variadics, value kinds, and command paths retain compile-time checking. Fresh object literals reject typo keys alongside valid required fields; standard structural assignability still permits extra keys on predeclared objects. Schemas and custom parsers retain raw input contracts independently of their action output types.
  
  A bare `Crust` has an empty argument tuple. Prefer inferred authoring builders; `AnyCrust` is a completed-app inspection/invocation view with broad input and an unknown action result, not authoring authority. Dynamic/open shapes retain independently known fields, and uncertain unions retain conservative obligations. Broad string names work without wrappers; known-invalid union members remain rejected.
  
  Own normalized structural definition arrays without cloning JSON, URL, schema, callback, or Context-option payloads. Preserve Context/Extension defining data through structural copies, lazy setup, once-per-invocation resolution, replacement ordering, preRun/finish ordering, and cleanup. Keep static duplicate checks that protect earlier typed consumers; supported dynamic replacements retain last-write-wins. Supplied removed flag keys fail binding, but omitting a retired defaulted flag can still leave an earlier action observing undefined.
  
  Preserve TypeScript-owned metadata, dependency, and callback-value demands, including conditional/nested providers used by descendant hooks. Recipe-local duplicate Context checks use actual local providers rather than inherited/demanded names, allowing compatible local provisioning while rejecting incompatible values and repeated local providers. Preserve precise static Extension contributions and migrate configurable Completion/Skills callers to ordinary composition.
- Updated dependencies [[`0b0aeca`](https://github.com/chenxin-yan/crust/commit/0b0aecaed104b6ee548ae01f589c71c44a2eb9bc), [`7d72b4c`](https://github.com/chenxin-yan/crust/commit/7d72b4cfd235517e941e9384516a80f8dfa74e95), [`38e7298`](https://github.com/chenxin-yan/crust/commit/38e7298954c60ec0a45dcfa830b515b2bc32ece0), [`cc466b5`](https://github.com/chenxin-yan/crust/commit/cc466b5a0b5792d4811e85d82e341980bc1fb606), [`7d72b4c`](https://github.com/chenxin-yan/crust/commit/7d72b4cfd235517e941e9384516a80f8dfa74e95), [`7d72b4c`](https://github.com/chenxin-yan/crust/commit/7d72b4cfd235517e941e9384516a80f8dfa74e95), [`cb0e9f1`](https://github.com/chenxin-yan/crust/commit/cb0e9f1f0538c0576505534d429566ed29bcb996), [`37a4ae1`](https://github.com/chenxin-yan/crust/commit/37a4ae15d7cc635406ad2f7643afaad6d7391e75), [`72b462e`](https://github.com/chenxin-yan/crust/commit/72b462e110c421ce453b7a2f81ef0e284f908607), [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce), [`7d72b4c`](https://github.com/chenxin-yan/crust/commit/7d72b4cfd235517e941e9384516a80f8dfa74e95)]:
  - @crustjs/core@0.2.0

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
