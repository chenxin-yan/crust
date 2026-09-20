# @crustjs/core

## 0.3.3

### Patch Changes

- [#413](https://github.com/chenxin-yan/crust/pull/413) [`63ef15c`](https://github.com/chenxin-yan/crust/commit/63ef15c2a009c87cc568d1eab2d1011332417057) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Finished Bun and Node CLI bundles (built by `crust build`) no longer include the `CRUST_INTERNAL_SNAPSHOT_PATH` snapshot/build-hook protocol: the bundle is smaller and dispatches normally even when that variable is set. Source entries run by `crust build` and Deno binaries are unchanged.

## 0.3.2

### Patch Changes

- [#411](https://github.com/chenxin-yan/crust/pull/411) [`2cbdc21`](https://github.com/chenxin-yan/crust/commit/2cbdc2122f7bffbad42b79185bf0e4d8d97021a7) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Depend on the published `@crustjs/utils` package instead of inlining its sources into the bundle.
- Updated dependencies [[`2cbdc21`](https://github.com/chenxin-yan/crust/commit/2cbdc2122f7bffbad42b79185bf0e4d8d97021a7)]:
  - @crustjs/utils@0.1.0

## 0.3.1

No changes in this release.

## 0.3.0

### Minor Changes

- [#386](https://github.com/chenxin-yan/crust/pull/386) [`955f85c`](https://github.com/chenxin-yan/crust/commit/955f85c130400c7c8d0e63efa9b16807482dba3e) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - ### @crustjs/crust
  
  `crust build` now stages publishable npm packages in `.crust/`, replacing that tree on each staged build. Node produces a root-only package with a self-contained `bin/<command>.js` bundle; Bun and Deno produce a root launcher plus platform packages. Deno's Linux targets are glibc-only. The staged CLI runs locally, and `crust publish` publishes the same tree using `.crust/manifest.json`.
  
  `crust build` keeps four flags: `--target` (repeatable; canonical names or `host` for this machine, deduplicated), `--env-file`, `--validate/--no-validate`, and `--minify/--no-minify`. Removed `--package`, `--stage-dir` (build and publish), `--outdir`, `--name`, `--resolver`, `--outfile`, `--runtime`, `--entry`, `--bun-plugin`, and the raw `dist/` multi-binary layout with `cli`/`cli.cmd` shell resolvers. For a single binary on Bun or Deno, run `crust build --target host` and take `.crust/<platform>/bin/<command>-<target>`; Node accepts no `--target` and always produces `.crust/root/bin/<command>.js`. `.crust/manifest.json` is the index.
  
  Build configuration lives in one `package.json` block; unknown keys under `crust` are an error:
  
  ```json
  {
    "bin": { "my-cli": "src/cli.ts" },
    "crust": {
      "runtime": "bun",
      "bunPlugins": ["@opentui/solid/bun-plugin"],
      "include": ["templates"]
    }
  }
  ```
  
  Runtime selection follows `crust.runtime`, then inference: `deno.json`/`deno.jsonc` selects Deno; `@types/node` without `@types/bun` selects Node; otherwise Bun. Builds report the selected runtime and its source. `crust.bunPlugins` lists Bun bundler plugin modules: bare names resolve from `node_modules`, paths from the project root, each default-exporting the plugin; Deno rejects it. `crust.include` copies asset directories alongside Extension artifacts into the root package and each platform package's `bin/`. Every bundle defines `process.env.CRUST_INTERNAL_BUILD` as `"1"`; the name is reserved and reads of it are replaced at build time.
  
  `@crustjs/crust` ships a JSON schema for the `crust` block at `node_modules/@crustjs/crust/schema/package.json` (extending SchemaStore's package.json schema) for editor completion; point `"$schema"` at it in `package.json`.
  
  `crust publish` keeps `--tag`, `--dry-run`, and `--registry`; removed `--access` and `--verify`. Staged metadata is always verified. npm reads `publishConfig.access` from each staged `package.json`, so scoped public packages need `publishConfig.access: "public"` in `package.json` (copied into every staged package). `npm publish` runs inside each `.crust/<package>` directory, so a project-level `.npmrc` is not read; use trusted publishing, `NPM_CONFIG_USERCONFIG`, or `~/.npmrc`.
  
  ### create-crust
  
  Replaced the distribution-mode prompt and `--distribution` with a runtime prompt and `--runtime bun|node|deno`. All templates explicitly set `crust.runtime`, point `bin` at `src/cli.ts` (which starts with the runtime's shebang: `#!/usr/bin/env bun`, `#!/usr/bin/env node`, or `#!/usr/bin/env -S deno run -A`, so `npm link` runs the source), and use `build` (`crust build`), `release` (`crust publish`), and `start` (the staged `.crust/root/bin/<name>.js` entry). Removed the old `package`, `publish`, and `prepack` scripts and `files` field; `.crust` is gitignored.
  
  Templates use runtime-specific TypeScript settings, JSON import attributes, and script-runner instructions. `@crustjs/core` and `@crustjs/extensions` are dependencies; `@crustjs/crust` is a development dependency.
  
  Generated `package.json` files start with `"$schema": "./node_modules/@crustjs/crust/schema/package.json"` so editors complete and validate the `crust` block.
  
  `create-crust` itself now ships as a Crust-built Node bundle, with templates staged through `crust.include` and located through `resolveArtifactDir("templates")`.
  
  ### @crustjs/core
  
  Added `resolveArtifactDir(name)` for top-level artifact directories: beside the executable in compiled Bun/Deno binaries, beside `bin/` in Crust-built Node bundles, under the entry's isolated hook output directory while `crust build` prepares the Command Snapshot (so sections evaluated during the build see what earlier Extension build hooks wrote), or under `.crust/root/` at the real entrypoint's nearest package root when running from source. It computes the path without checking whether the artifact directory exists.
  
  ### @crustjs/skills
  
  Removed `SkillOptions.distDir` and the previous skill-source fallback logic. Packaged skills now come from `resolveArtifactDir("skills")`; remove `distDir` from your configuration and run `crust build`. Missing or empty packaged skills produce a build-first diagnostic, rendered as a note in help rather than failing help.

- [#393](https://github.com/chenxin-yan/crust/pull/393) [`19c99e7`](https://github.com/chenxin-yan/crust/commit/19c99e77ffcff792527064354b2c5b9d756c51df) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - ### @crustjs/core
  
  **Breaking:** Extension build hooks return their files instead of writing them. `build(ctx)` now returns `BuildArtifacts = readonly BuildFile[]`, where `BuildFile` is `{ path, content }` with `path` relative to the build output directory and `content` a `string` or `Uint8Array`. Returning `void` is no longer allowed. Core validates every path, rejects a path that collides with one already produced in this or an earlier hook (equal paths compared case-insensitively, or a path nested under or above an existing file; the error names both spellings and the owning Extension), writes the files into the output directory, and records exactly the written paths; `BuildReport.extensions[].files` is always `readonly string[]` (the `"unknown"` marker is gone). `ExtensionBuildContext` no longer exposes `outDir`: hooks have no handle to write beside their returned files, which is what makes the report exact. A hook that drives an external tool should write to its own temporary directory and read the results back.
  
  Migration: replace `mkdir`/`writeFile` calls in a hook with returned entries, and drop `outDir` from the destructured context.
  
  ```ts
  // before
  async build({ snapshot, outDir }) {
    await mkdir(join(outDir, "acme"), { recursive: true });
    await writeFile(join(outDir, "acme", "manifest.json"), JSON.stringify(snapshot));
    return ["acme/manifest.json"];
  }
  // after
  build({ snapshot }) {
    return [{ path: "acme/manifest.json", content: JSON.stringify(snapshot) }];
  }
  ```
  
  ### @crustjs/crust
  
  `crust build` records each `bin` entry's Build Report under `build` in `.crust/manifest.json` (`build.<command>.extensions[].files`), so the manifest lists exactly which files every Extension produced. The field is absent under `--no-validate`, which skips the hooks. The build summary no longer prints `ran (artifacts not reported)`. Since hooks cannot produce symlinks anymore, multi-entry artifact merging no longer copies symlinks.
  
  ### @crustjs/man
  
  The `man()` build hook returns the rendered page instead of writing it. `writeManPage()` is unchanged as a standalone render-and-write helper.
  
  ### @crustjs/skills
  
  The `skill()` build hook returns rendered skill files instead of writing them. `writeSkills()` and `writeSkillsFromSnapshot()` are unchanged: they still replace the dedicated `skills` output directory.
  
  ### @crustjs/extensions
  
  The `completion()` build hook returns the three shell scripts instead of writing them. The runtime `completion <shell> --output-dir` command still writes all three files.

- [#376](https://github.com/chenxin-yan/crust/pull/376) [`9961a9b`](https://github.com/chenxin-yan/crust/commit/9961a9ba254ba1b58746ea0c6e8b43c76a9268e3) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Add `app.at(path)`, which returns a typed `CommandHandle` bound to one command. `handle.run(input?, io?)` accepts the same structured input and IO as `app.run(path, ...)` with the path already applied, so a subcommand can be re-exported as a typed library function or handed to other commands and test helpers. Unknown paths throw `COMMAND_NOT_FOUND` eagerly from `at()`.

### Patch Changes

- [#377](https://github.com/chenxin-yan/crust/pull/377) [`c15d855`](https://github.com/chenxin-yan/crust/commit/c15d855b43d55605a310719c63f50d89c23a416d) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Adapter hook: expose bag sources and instance factory. Context bags carry their sources under the non-enumerable `contextSources` symbol, and Context instances expose their defining `factory`.

- [#390](https://github.com/chenxin-yan/crust/pull/390) [`e450975`](https://github.com/chenxin-yan/crust/commit/e450975f70d9dffda5fe068b55d56c48eb17ab44) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Resolve source-linked command artifacts from the real entrypoint package instead of the consumer package. Preserve existing compiled and bundled artifact lookup.

- [#396](https://github.com/chenxin-yan/crust/pull/396) [`015bcdb`](https://github.com/chenxin-yan/crust/commit/015bcdb1e9ca9285d3029794c573bb3f3ea3aa73) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Improve positional type capacity with accumulator duplicate-name scanning. Fifty and one hundred chained arguments now support action inference and typed run inputs while preserving duplicate and union semantics; this is not a compiler-speed claim.

- [#392](https://github.com/chenxin-yan/crust/pull/392) [`33cd937`](https://github.com/chenxin-yan/crust/commit/33cd93792366803f2b33fac16fc4ab99057f9b0b) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Reject statically known invalid members of a name union even when another member is an open template, such as `` "" | `mode-${string}` `` or `` "__proto__" | `mode-${string}` ``. Applies to command names, command aliases, `.as()` renames, argument names, and flag names, short flags, and aliases. Open members remain runtime-checked and still keep attachment records open. `.add(cond ? a : b)` no longer rejects a definition union whose variants alias each other's canonical name (`a` named `x` with alias `y`, `b` named `y` with alias `x`); each variant is compared with its own aliases only.

- [#396](https://github.com/chenxin-yan/crust/pull/396) [`015bcdb`](https://github.com/chenxin-yan/crust/commit/015bcdb1e9ca9285d3029794c573bb3f3ea3aa73) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Preserve action-local Context value obligations after binding. Incompatible inherited shadowing is still allowed before an action; compatible replacements and independent descendant shadowing remain valid. Previously accepted replacements that invalidate a stored action now fail typechecking.

- [#396](https://github.com/chenxin-yan/crust/pull/396) [`015bcdb`](https://github.com/chenxin-yan/crust/commit/015bcdb1e9ca9285d3029794c573bb3f3ea3aa73) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Fix prototype-named flag and positional binding, and await foreign-realm Standard Schema validation without changing synchronous custom-parser payloads.

- [#396](https://github.com/chenxin-yan/crust/pull/396) [`015bcdb`](https://github.com/chenxin-yan/crust/commit/015bcdb1e9ca9285d3029794c573bb3f3ea3aa73) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Tighten Extension hook flag inference: uncertain scopes may omit defaults, uncertain collections expose raw values, and optional schema multiplicity includes arrays. Previously unsafe scalar assumptions now require narrowing.

- [#376](https://github.com/chenxin-yan/crust/pull/376) [`9961a9b`](https://github.com/chenxin-yan/crust/commit/9961a9ba254ba1b58746ea0c6e8b43c76a9268e3) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Fix typed `run()` paths through siblings registered by one variadic `.add(a, b)` call: each path now narrows to its own command's input and result instead of the union of every sibling's shape.

- [#375](https://github.com/chenxin-yan/crust/pull/375) [`1a919d7`](https://github.com/chenxin-yan/crust/commit/1a919d773f592cab65afd8d8f437c7947016523d) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Prevent variadic calls on conditional builder unions from silently losing input validation and inferred value types. `.provide()`, `.use()`, and `.add()` reject failed input inference, while allowing explicit input tuples that pass validation. `.flags()`, `.args()`, and `.extend()` reject incompatible union signatures.
  
  Use lightweight input defaults for Context and command registrations to avoid repeated whole-builder type instantiations on large command trees. Unconditional chains, identical-branch unions, and non-variadic methods are unchanged; no runtime change.

## 0.2.1

### Patch Changes

- [#371](https://github.com/chenxin-yan/crust/pull/371) [`d103a76`](https://github.com/chenxin-yan/crust/commit/d103a7688dd3240c913596e46f6100b772ded80d) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Raise the supported Bun floor to 1.4.0.
  
  Every package now declares `engines.bun` as `>=1.4.0`, and Bun 1.3 is no longer tested. Bun 1.4 ships a single x64 binary, which is what lets `crust build` use the canonical `bun-linux-x64` and `bun-windows-x64` target names.

## 0.2.0

### Minor Changes

- [#360](https://github.com/chenxin-yan/crust/pull/360) [`0b0aeca`](https://github.com/chenxin-yan/crust/commit/0b0aecaed104b6ee548ae01f589c71c44a2eb9bc) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Attribute files returned by Extension build hooks to their Extension ids, transport the Build Report to `crust build`, and print a concise per-hook artifact summary before compilation.

- [#361](https://github.com/chenxin-yan/crust/pull/361) [`38e7298`](https://github.com/chenxin-yan/crust/commit/38e7298954c60ec0a45dcfa830b515b2bc32ece0) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Replace the separate command recipe builder interface with a capability-typed `Crust`, keeping root-only operations uncallable in recipes across fluent chains.

- [#366](https://github.com/chenxin-yan/crust/pull/366) [`59b8ec6`](https://github.com/chenxin-yan/crust/commit/59b8ec6ae3eae3da450d3297e375fee057296379) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Add `defer(cleanup)` to Context setup. Cleanup registered with `defer` runs after post-run hooks in reverse registration order, including when the action or a later step of the same setup throws, so a value no longer needs a `[Symbol.dispose]` method to release what setup opened. Returned disposable values are still disposed automatically. Calling `defer` after setup has settled throws a `DEFINITION` error.
  
  ```ts
  // before
  defineContext("database", () => {
    const db = open();
    return { ...db, [Symbol.dispose]: () => db.close() };
  });
  
  // after
  defineContext("database", ({ defer }) => {
    const db = open();
    defer(() => db.close());
    return db;
  });
  ```

- [`cc466b5`](https://github.com/chenxin-yan/crust/commit/cc466b5a0b5792d4811e85d82e341980bc1fb606) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Breaking API revamp: replace plugin-driven builders with reusable commands, Contexts, and Extensions.
  
  - **Definitions and composition:** `defineCommand(name, config, recipe)` creates an inert reusable command attached with `.add(...definitions)`; `.as(name)` reuses it under another name. Root-only `.command(name, recipe)` remains inline sugar, but `.command(builder)`, `.sub()`, and `.meta()` are removed. Root metadata moves to `new Crust(name, { description, version, usage, sections })`; `version` is rejected in reusable command configs. `defineFlag` and `defineArg` create named definitions: use accumulative `.flags(...defs)` and `.args(...defs)` instead of records and tuples. Every positional argument now requires a core `type` or Standard Schema `schema`.
  - **Extensions replace plugins:** attach `defineExtension(defineExtensionId("acme:feature"), config)` with `.extend(...extensions)` instead of `.use(plugin)`. `defineExtension(id, factory)` returns a callable `ExtensionFactory` with shared `.id`. Named `hooks` replace middleware and builder lifecycle handlers: `preRun(ctx)` can return `ctx.finish()`, `postRun(ctx, outcome)` runs in reverse Extension order after settlement, and `onError(error, ctx)` returns `true` after rendering an `execute()` failure. Extension flags are readonly arrays of named definitions; `recursive` defaults to `true`. Commands contributed by Extensions use `defineCommand()`.
  - **Contexts:** `defineContext(name, { flags?, uses? }, setup)` declares a lazy dependency. Applications supply `.provide(...instances)`, commands demand `.use(...factories)`, and Contexts/Extensions declare dependencies with `uses`. Actions access values through `ctx`; `.of(value)` supplies dependency-free test doubles. Contexts dispose through `Symbol.dispose`/`Symbol.asyncDispose` in reverse construction order. `FlagDef.inherit` is removed: use Context-owned flags or recursive Extension flags to reach subcommands.
  - **Actions and execution:** `.action(handler)` replaces `.run(handler)`; repeating `.action()` replaces the handler. Action contexts expose lazy `ctx`, `stdout`/`stderr`, and `command`/`rootCommand` snapshots. `.run(path, input?, io?)` invokes a command programmatically with quiet captured output and returned failed outcomes. `.execute({ argv?, io? })` renders failures, sets `process.exitCode`, and now resolves to the exit code (`0`, `1`, or `130`) rather than `void`. Cancellation uses `AbortError`, is offered to `onError`, and stays silent when unclaimed. Handled failures expose the rendering Extension's id in `InvocationOutcome.by`; fallback rendering leaves it undefined. `onError` settles before `postRun`, and Contexts remain available through both hooks.
  - **Typed invocation:** `run()` infers command paths, arguments, flags, and action results. It binds structured input directly, without producing argv; only own argument/flag properties count as supplied. JSON and URL values retain identity; JSON inputs accept named interfaces, readonly arrays, and tuples when recursively JSON-compatible at the type level. Extension hooks see the command path only in `argv`. `RunOutcome` always carries captured `stdout`/`stderr` and is `completed` with the typed `result`, `finished` with the finishing Extension's `by` identity, or `failed` with the original escaping `error`. Statically declared Extension commands/flags participate in inference; dynamic contributions remain runtime-only. Literal string `choices` narrow result types unless `parse` supplies its own output type.
  - **Validation and errors:** arg/flag definitions accept Standard Schema through `schema`, replacing `@crustjs/validate`. Compile-time `FIX_*` diagnostics reject invalid names, aliases, defaults, variadic placement, schema combinations, async parsers, section audiences, and dependency graphs; dynamic definitions fail with `DEFINITION` at composition. `CrustError` codes are `DEFINITION`, `PARSE`, `VALIDATION`, and `COMMAND_NOT_FOUND`; `CONFIG` and `EXECUTION` are removed, and action/Context failures pass through unwrapped. `DEFINITION` and `PARSE` gain structured details (`DefinitionErrorDetails`, `ParseErrorDetails`); `COMMAND_NOT_FOUND.details.parentCommand` becomes a `CommandSnapshot`. `toJSON()` and `CrustErrorJson` are added.
  
  **Parser and routing**
  
  - Undeclared positionals now fail with `VALIDATION` instead of being discarded. Declare a variadic argument for open-ended input, or read opaque `rawArgs` after `--`.
  - Boolean negation accepts every long alias (`--no-<alias>`); negating a `noNegate` flag through any spelling fails with `PARSE`.
  - Routing skips known flags and their values before subcommands, including aliases, inline values, and bundled short booleans. Recursive flags bind to the selected child (`app --help sub` shows child help). A flag before a subcommand that the child cannot accept fails with an explanatory `PARSE` error. Unknown flags and `--` still stop routing.
  - Missing or invalid flag values report Node's descriptive `PARSE` message naming the flag instead of `Failed to parse command arguments`.
  - Tokens such as `constructor` and `__proto__` report `COMMAND_NOT_FOUND` instead of crashing; `details.available` lists only visible sibling commands.
  
  **Snapshots, sections, and public types**
  
  - `await app.snapshot()` replaces `prepareCommandTree()` with a frozen `CommandSnapshot`. Commands and Extensions can contribute plain-text documentation sections. Sections reach every renderer by default; `only`/`except` select audiences using factories, `ExtensionId` values, or factory statics such as `help.id`. The `crust:` prefix is reserved by convention. `CommandSection`, `CommandSectionInput`, `SectionAudience`, `SectionConsumer`, and arg/flag snapshot types are exported; `FlagSnapshot.negatable` exposes parser policy.
  - New `@crustjs/core/tooling` exports `buildCommandDocumentation`, `formatDefault`, `formatDescription`, `isListed`, `sectionsFor`, `visibleSectionsFor`, documentation types, and the build protocol constants `SNAPSHOT_PATH_ENV`/`BUILD_OUT_DIR_ENV`. Extensions can declare `build(ctx)` with an `ExtensionBuildContext` containing the root snapshot and absolute output directory.
  - Removed root exports: `parseArgs`, `validateParsed`, `resolveCommand`, `CommandRoute`, `CommandNode`, `CrustPlugin`, `PluginMiddleware`, `SetupActions`, `SetupContext`, `MiddlewareContext`, `VALIDATION_MODE_ENV`, `VALIDATION_FORCE_EXIT_ENV`, `ValidateVariadicArgs`, `ValidateNoPrefixedFlags`, `ValidateFlagAliases`, `ValidateCrossCollisions`, `Resolve`, `ResolveBaseType`, `InferArgs`, `InferFlags`, `InheritableFlags`, and `EffectiveFlags`. Build integrations use the new snapshot protocol instead of `CRUST_INTERNAL_VALIDATE_*`.
  - Prefer inference over positional `Crust` generic annotations: the generic parameters have changed. Exported command, Context, Extension, and run-input/result types name the new contracts. `Crust._types` (`flags`, `args`, `ctx`, `tree`, `shape`) is a supported type-level seam with no runtime value.

- [#355](https://github.com/chenxin-yan/crust/pull/355) [`7d72b4c`](https://github.com/chenxin-yan/crust/commit/7d72b4cfd235517e941e9384516a80f8dfa74e95) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Make core `run()` quiet and captured by default. Every `RunOutcome` includes `stdout` and `stderr`; completed outcomes carry the typed action result, finished outcomes identify the Extension, and failed outcomes retain the original escaping error and partial output after cleanup. Invocation failures now resolve to `failed` instead of rejecting. Optional IO callbacks forward live output once while retaining capture. `execute()` remains the streaming terminal adapter with error presentation and exit codes.
  
  Remove `captureRun` and `CapturedRun` from `@crustjs/testing`: call `app.run(path, input)` directly. Keep `captureExecute` for terminal semantics. `runInteractive` explicitly propagates failed core outcomes through `done` and `waitFor`, including primitive thrown values.

- [#355](https://github.com/chenxin-yan/crust/pull/355) [`7d72b4c`](https://github.com/chenxin-yan/crust/commit/7d72b4cfd235517e941e9384516a80f8dfa74e95) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Default `ExtensionFactory` dependency, provider, flag, and command parameters to closed contribution sets. Published factories can now omit empty trailing type arguments; explicitly use the broad upper-bound type for namespaces that must remain open.

- [#354](https://github.com/chenxin-yan/crust/pull/354) [`cb0e9f1`](https://github.com/chenxin-yan/crust/commit/cb0e9f1f0538c0576505534d429566ed29bcb996) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Add curried, extension-owned root metadata requirements with defineExtension<"version">()(id, configOrFactory). Required keys refine hook and artifact snapshots and are checked by strict TypeScript when installing extensions. version() now requires guaranteed root version metadata unless an explicit string or lazy provider is supplied; remove its runtime missing-version error. Keep ordinary defineExtension calls unchanged and put scaffold versions in root metadata. Root metadata now rejects statically known extra keys on pretyped objects as well as fresh literals; generic wrappers must also establish that their metadata contains only root keys.

- [#359](https://github.com/chenxin-yan/crust/pull/359) [`37a4ae1`](https://github.com/chenxin-yan/crust/commit/37a4ae15d7cc635406ad2f7643afaad6d7391e75) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Merge documentation sections with the same exact title after audience filtering, preserving their first position and joining bodies with a single newline.

- [#307](https://github.com/chenxin-yan/crust/pull/307) [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Update runtime compatibility and package builds.
  
  - Libraries support Bun 1.3.14+, Node.js 22+, and Deno 2.8+ (`engines` updated). Context disposal includes a fallback for runtimes without `AsyncDisposableStack`, including Node 22/23. The `crust` build CLI remains Bun tooling; its npm distribution ships standalone executables with Bun embedded.
  - Published packages no longer depend on `@crustjs/utils`; its helpers are bundled. `@crustjs/store` also drops `@standard-schema/spec`. Library packages and `create-crust` are marked `sideEffects: false` for bundlers.
  - Packages shipping declarations declare an optional TypeScript `^7.0.0` peer; builder inference is supported on TypeScript 7. JavaScript consumers are unaffected by this compiler requirement.

- [#355](https://github.com/chenxin-yan/crust/pull/355) [`7d72b4c`](https://github.com/chenxin-yan/crust/commit/7d72b4cfd235517e941e9384516a80f8dfa74e95) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Automatically validate observable constraints at authoring, preparation, deferred definition consumption, and invocation. Dynamic names and collections use the same APIs; spread collections into variadic builder methods. Consume deferred Extension factory/section results when produced and verify declared Context availability without constructing Contexts.
  
  Keep known invocation contracts strict: literal choices, required fields, supplied positional prefixes, nonempty required variadics, value kinds, and command paths retain compile-time checking. Fresh object literals reject typo keys alongside valid required fields; standard structural assignability still permits extra keys on predeclared objects. Schemas and custom parsers retain raw input contracts independently of their action output types.
  
  A bare `Crust` has an empty argument tuple. Prefer inferred authoring builders; `AnyCrust` is a completed-app inspection/invocation view with broad input and an unknown action result, not authoring authority. Dynamic/open shapes retain independently known fields, and uncertain unions retain conservative obligations. Broad string names work without wrappers; known-invalid union members remain rejected.
  
  Own normalized structural definition arrays without cloning JSON, URL, schema, callback, or Context-option payloads. Preserve Context/Extension defining data through structural copies, lazy setup, once-per-invocation resolution, replacement ordering, preRun/finish ordering, and cleanup. Keep static duplicate checks that protect earlier typed consumers; supported dynamic replacements retain last-write-wins. Supplied removed flag keys fail binding, but omitting a retired defaulted flag can still leave an earlier action observing undefined.
  
  Preserve TypeScript-owned metadata, dependency, and callback-value demands, including conditional/nested providers used by descendant hooks. Recipe-local duplicate Context checks use actual local providers rather than inherited/demanded names, allowing compatible local provisioning while rejecting incompatible values and repeated local providers. Preserve precise static Extension contributions and migrate configurable Completion/Skills callers to ordinary composition.

### Patch Changes

- [#355](https://github.com/chenxin-yan/crust/pull/355) [`7d72b4c`](https://github.com/chenxin-yan/crust/commit/7d72b4cfd235517e941e9384516a80f8dfa74e95) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - `.provide()` now rejects a broad-named provider whose value type does not satisfy a dependency declared by a later provider, including when a known literal provider sits beside an unknown broad provider (`FIX_DEPENDENCY_TYPE`). Previously these mismatches compiled and surfaced only as runtime `TypeError`s.

- [#353](https://github.com/chenxin-yan/crust/pull/353) [`72b462e`](https://github.com/chenxin-yan/crust/commit/72b462e110c421ce453b7a2f81ef0e284f908607) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Reduce redundant child-map copying during command registration, accumulating variadic additions in one private map while preserving eager materialization and immutable builders.

## 0.0.19

### Patch Changes

- Updated dependencies [e298f11]
  - @crustjs/utils@0.0.3

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
    cmd.meta({ aliases: ["issues", "i"] }).run(() => {})
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
