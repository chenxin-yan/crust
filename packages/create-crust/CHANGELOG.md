# create-crust

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

- [#307](https://github.com/chenxin-yan/crust/pull/307) [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Make the scaffolder runtime-portable and fix overwrite handling.
  
  - The scaffolder runs on Bun, Deno, and Node: post-scaffold commands use Node-compatible process APIs, and `create-crust` can be launched with npm, pnpm, Bun, or Deno.
  - Fix `--overwrite`: a confirmed overwrite is passed through to the scaffolder, so scaffolding into an existing non-empty destination works instead of aborting. Scaffolding into a non-empty current directory (`create-crust .`) asks for confirmation (pre-answered by `--overwrite`/`--no-overwrite`) instead of failing.
  - Scaffolded projects depend on TypeScript 7 (`^7.0.2`), the Go-native compiler; `tsc --noEmit` and all generated scripts work unchanged.
  - The unused `isGitInstalled` API is removed from `@crustjs/create`.

- [#307](https://github.com/chenxin-yan/crust/pull/307) [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Modernize the runtime support matrix and package builds.
  
  - Supported runtimes: Bun 1.3.14+, Node.js 22+, and Deno 2.8+. Package runtime code is portable across all three — Bun globals are replaced with Node-compatible built-ins, and process spawning uses `node:child_process`. On runtimes without `AsyncDisposableStack` (Node 22/23), invocations fall back to an in-package disposal stack.
  - Package builds migrate to tsdown (Rolldown) and modules are marked side-effect free. Internal `@crustjs/utils` imports are inlined, fixing `@crustjs/store` installs that previously required `@crustjs/utils` at runtime. Consumers bundling with Bun 1.3.10–1.3.13 may encounter oven-sh/bun#27709 when tree-shaking packages with `sideEffects: false`.
  - All packages that ship type declarations declare an optional `typescript: "^7.0.0"` peerDependency. Builder inference performance is measured and supported against the native TypeScript 7 compiler; plain-JavaScript consumers are unaffected.

### Patch Changes

- Updated dependencies [[`ac028c8`](https://github.com/chenxin-yan/crust/commit/ac028c8a8694fc4d685ed7140353a881bc92aeb6), [`0ce45f4`](https://github.com/chenxin-yan/crust/commit/0ce45f4cd41cc4c9ef4181a23ea6360fd756b49b), [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce), [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce), [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce), [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce), [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce), [`ff01466`](https://github.com/chenxin-yan/crust/commit/ff01466931a7f0616ac01e9ea6be2285f702344f), [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce), [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce), [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce), [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce)]:
  - @crustjs/core@0.2.0
  - @crustjs/create@0.1.0
  - @crustjs/progress@0.1.0
  - @crustjs/prompts@0.2.0

## 0.0.31

### Patch Changes

- @crustjs/core@0.0.19
- @crustjs/create@0.0.7

## 0.0.30

### Patch Changes

- Updated dependencies [0dc69b1]
- Updated dependencies [d08439a]
- Updated dependencies [c4d2b22]
- Updated dependencies [c4d2b22]
  - @crustjs/core@0.0.18
  - @crustjs/create@0.0.6

## 0.0.29

### Patch Changes

- 173960e: Use bundled package versions for scaffolded `@crustjs/*` dependency ranges instead of `latest`.
- Updated dependencies [b87e0ee]
- Updated dependencies [f1baa45]
- Updated dependencies [8779692]
- Updated dependencies [67f815a]
- Updated dependencies [9db2613]
- Updated dependencies [3421dbf]
  - @crustjs/core@0.0.17
  - @crustjs/prompts@0.1.0
  - @crustjs/progress@0.0.4

## 0.0.28

### Patch Changes

- df08a3a: fix create crust typescript version
- Updated dependencies [7ca5e5f]
  - @crustjs/prompts@0.0.13
  - @crustjs/progress@0.0.3

## 0.0.27

### Patch Changes

- Updated dependencies [23fae62]
  - @crustjs/prompts@0.0.12

## 0.0.26

### Patch Changes

- 341f3b1: Add a new `@crustjs/progress` package and move the canonical `spinner()` implementation there.

  `@crustjs/prompts` now temporarily re-exports `spinner` and related types as deprecated compatibility exports, with removal planned for `v0.1.0`.

  Update internal consumers and docs to use `@crustjs/progress` as the new home for spinner-based progress UI.

- 291048b: Fix `create-crust` dependency installation on Windows and run `command` steps through Bun Shell for cross-platform shell execution.
- Updated dependencies [def425e]
- Updated dependencies [341f3b1]
- Updated dependencies [291048b]
  - @crustjs/core@0.0.16
  - @crustjs/progress@0.0.2
  - @crustjs/prompts@0.0.11
  - @crustjs/create@0.0.5

## 0.0.25

### Patch Changes

- @crustjs/prompts@0.0.10

## 0.0.24

### Patch Changes

- Updated dependencies [5e0afa4]
  - @crustjs/core@0.0.15

## 0.0.23

### Patch Changes

- 86e09aa: Rename `--distribute` build flag to `--package` across CLI, templates, and docs
- Updated dependencies [f78b327]
  - @crustjs/core@0.0.14

## 0.0.22

### Patch Changes

- a69c4d9: Add per-platform npm distribution workflow with `crust build --distribute` and `crust publish` commands. The build command now supports `--distribute` and `--stage-dir` flags to stage per-OS/arch npm packages with platform-specific binaries and shell/cmd resolvers. The new `publish` command publishes staged packages in dependency order. Updated `create-crust` binary distribution template to use the new distribute/publish workflow.

## 0.0.21

### Patch Changes

- Updated dependencies [6dea64c]
- Updated dependencies [819bad7]
  - @crustjs/core@0.0.13
  - @crustjs/prompts@0.0.9

## 0.0.20

### Patch Changes

- 9a216fd: Add distribution mode choice for scaffolded templates

  `create-crust` now asks whether you plan to distribute as standalone binaries or as a Bun runtime package, then scaffolds layered templates for the selected combination.

  Changes:

  - Added a new `Distribution mode` prompt during scaffolding
  - Refactored templates into composable layers: `base` + style variant (`minimal` / `modular`) + distribution variant (`binary` / `runtime`)
  - `Standalone binaries` mode keeps Crust packages in `devDependencies` and enables `prepack`
  - `Bun runtime package` mode moves `@crustjs/core` and `@crustjs/plugins` to `dependencies`, updates `build` to output `dist/cli.js`, and points `bin` to `dist/cli.js`
  - Updated template and installation docs to describe both distribution strategies

- Updated dependencies [b8ebfa4]
  - @crustjs/core@0.0.12

## 0.0.19

### Patch Changes

- Updated dependencies [9f81bcc]
- Updated dependencies [72ea166]
  - @crustjs/core@0.0.11

## 0.0.18

### Patch Changes

- Updated dependencies [f704195]
  - @crustjs/prompts@0.0.8

## 0.0.17

### Patch Changes

- fda33c2: Add a new modular starter template that demonstrates the file-splitting subcommand pattern with `.sub()` and `.command(builder)`, and let users choose between Minimal and Modular template styles during scaffolding.
- 96ca6b2: Adopt the new builder-style command API across core and official packages, including inherited flags, lifecycle hooks, plugin usage, and command metadata improvements. Update related tooling, templates, and documentation to align with the new command authoring flow.
- Updated dependencies [96ca6b2]
  - @crustjs/core@0.0.10

## 0.0.16

### Patch Changes

- Updated dependencies [81608ea]
  - @crustjs/prompts@0.0.7

## 0.0.15

### Patch Changes

- a1f233e: Enable minification for all package builds, reducing bundle sizes by ~27%. Also shorten error messages in `@crustjs/core` for smaller output.
- b17db37: Improve input prompt UX: `default` value is now shown as placeholder text when `placeholder` is not explicitly set, reducing API redundancy. When both are provided, `placeholder` is used visually and the default hint `(value)` still appears.

  Updated `create-crust` to collect all prompts before executing file operations, preventing partial scaffolding on mid-prompt cancellation. The project directory prompt now uses `default: "my-cli"` so users can press Enter to accept it.

- 4f4bddf: Add `isInGitRepo` utility to detect if a directory is inside an existing git repository.

  Updated `create-crust` to skip the "Initialize a git repository?" prompt when scaffolding inside an existing repo, preventing accidental nested `.git` directories.

- Updated dependencies [a1f233e]
- Updated dependencies [b17db37]
- Updated dependencies [e3624b2]
- Updated dependencies [4f4bddf]
  - @crustjs/core@0.0.9
  - @crustjs/prompts@0.0.6
  - @crustjs/create@0.0.4

## 0.0.14

### Patch Changes

- 55b588b: Update scaffold template path resolution to be package-root based for better generator DX.

  - In `@crustjs/create`, relative string `template` paths now resolve from the nearest package root discovered from `process.argv[1]` (instead of `process.cwd()`).
  - Absolute string paths are treated as-is, and `file:` URL templates remain supported.
  - Added coverage for package-root resolution and explicit error cases when no package root can be found.
  - Updated `create-crust` to use `template: "templates/base"`, aligned with package-root template resolution.

- Updated dependencies [55b588b]
  - @crustjs/create@0.0.3

## 0.0.13

### Patch Changes

- Updated dependencies [695854e]
  - @crustjs/prompts@0.0.5

## 0.0.12

### Patch Changes

- Updated dependencies [384e2a9]
  - @crustjs/core@0.0.8

## 0.0.11

### Patch Changes

- Updated dependencies [1364768]
- Updated dependencies [967d2bf]
- Updated dependencies [e44d1c6]
- Updated dependencies [21298c8]
  - @crustjs/core@0.0.7
  - @crustjs/prompts@0.0.4

## 0.0.10

### Patch Changes

- 3d8b529: fix missing files field in package.json

## 0.0.9

### Patch Changes

- Updated dependencies [1b77051]
  - @crustjs/prompts@0.0.3

## 0.0.8

### Patch Changes

- Updated dependencies [f76fd1c]
- Updated dependencies [89f3828]
  - @crustjs/prompts@0.0.2

## 0.0.7

### Patch Changes

- da09867: Revamp scaffolding CLI: use `@crustjs/core` for command definition, `@crustjs/prompts` for interactive prompts, dynamic dependency installation via detected package manager, git-init confirmation prompt, and support scaffolding into the current directory with `.`.
- b415f81: **BREAKING:** Remove re-exports from `@crustjs/crust` — it is now a CLI-only package.

  `@crustjs/crust` no longer re-exports APIs from `@crustjs/core` and `@crustjs/plugins`. It now provides only the `crust` CLI binary (e.g., `crust build`) and should be installed as a dev dependency. Import framework APIs directly from `@crustjs/core` and `@crustjs/plugins` instead.

  Migration: replace `import { defineCommand, runMain, helpPlugin } from "@crustjs/crust"` with `import { defineCommand, runMain } from "@crustjs/core"` and `import { helpPlugin } from "@crustjs/plugins"`. Move `@crustjs/crust` to `devDependencies` and add `@crustjs/core` + `@crustjs/plugins` to `dependencies`.

- Updated dependencies [6e5d21d]
  - @crustjs/create@0.0.2

## 0.0.6

### Patch Changes

- 5110c83: Add `@crustjs/create` — a headless, zero-dependency scaffolding engine for building `create-xxx` tools.

  Provides `scaffold()` for template copying with `{{var}}` interpolation and dotfile renaming, `runSteps()` for declarative post-scaffold automation (install deps, git init, open editor, custom commands), and utilities for package manager detection and git user info.

  Refactor `create-crust` to use `@crustjs/create` as its scaffolding backend, replacing the inline implementation with the shared library (dogfooding).

- Updated dependencies [5110c83]
  - @crustjs/create@0.0.1

## 0.0.5

### Patch Changes

- 8e0b48a: Fix published package metadata containing unresolved workspace and catalog protocols by switching to bun publish

## 0.0.4

### Patch Changes

- dcc258c: switch to use literal string for flags and args types

## 0.0.3

### Patch Changes

- Update domain to crustjs.com, update dependencies, add homepage, and remove flaky cross-compilation tests
