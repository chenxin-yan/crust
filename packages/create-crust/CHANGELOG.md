# create-crust

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

- [#139](https://github.com/chenxin-yan/crust/pull/139) [`0ce45f4`](https://github.com/chenxin-yan/crust/commit/0ce45f4cd41cc4c9ef4181a23ea6360fd756b49b) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Require Bun 1.3.14 or newer across all published packages and remove the obsolete sync-disposal workaround now that `AsyncDisposableStack.use()` supports `Symbol.dispose`.

### Patch Changes

- [#139](https://github.com/chenxin-yan/crust/pull/139) [`0ce45f4`](https://github.com/chenxin-yan/crust/commit/0ce45f4cd41cc4c9ef4181a23ea6360fd756b49b) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Fix `--overwrite`: a confirmed overwrite is now passed through to the scaffolder, so scaffolding into an existing non-empty destination works instead of aborting. Scaffolding into a non-empty current directory (`create-crust .`) now asks for confirmation (pre-answered by `--overwrite`/`--no-overwrite`) instead of failing.

- [#139](https://github.com/chenxin-yan/crust/pull/139) [`0ce45f4`](https://github.com/chenxin-yan/crust/commit/0ce45f4cd41cc4c9ef4181a23ea6360fd756b49b) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Remove the unused `isGitInstalled` API and simplify scaffolding, build, path, and persistence internals.

- [`7145195`](https://github.com/chenxin-yan/crust/commit/7145195f073fd97ec8bffaded38dd7f2c679103d) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Scaffolded projects now depend on TypeScript 7 (`^7.0.2`), the Go-native compiler. `tsc --noEmit` and all generated scripts work unchanged.

- Updated dependencies [[`ac028c8`](https://github.com/chenxin-yan/crust/commit/ac028c8a8694fc4d685ed7140353a881bc92aeb6), [`0ce45f4`](https://github.com/chenxin-yan/crust/commit/0ce45f4cd41cc4c9ef4181a23ea6360fd756b49b), [`ff01466`](https://github.com/chenxin-yan/crust/commit/ff01466931a7f0616ac01e9ea6be2285f702344f), [`4e4af76`](https://github.com/chenxin-yan/crust/commit/4e4af76a7236f64ee843504126d09efb799d54ce), [`98cf6d1`](https://github.com/chenxin-yan/crust/commit/98cf6d193ddabdb9f1f9421935698e79bfc8cc6d), [`4e4af76`](https://github.com/chenxin-yan/crust/commit/4e4af76a7236f64ee843504126d09efb799d54ce), [`4e4af76`](https://github.com/chenxin-yan/crust/commit/4e4af76a7236f64ee843504126d09efb799d54ce), [`0ce45f4`](https://github.com/chenxin-yan/crust/commit/0ce45f4cd41cc4c9ef4181a23ea6360fd756b49b), [`048edf2`](https://github.com/chenxin-yan/crust/commit/048edf27d71b05e89426010064bf7c5be37fc0c6), [`2a3250e`](https://github.com/chenxin-yan/crust/commit/2a3250e3e78fc780b873ae9a1b4069997b1f0235), [`ff01466`](https://github.com/chenxin-yan/crust/commit/ff01466931a7f0616ac01e9ea6be2285f702344f), [`db943af`](https://github.com/chenxin-yan/crust/commit/db943af22e3d7e8766b396edd845487368040435), [`eb0add9`](https://github.com/chenxin-yan/crust/commit/eb0add9272d93f734ecf321e0b481a0aaf6da57e), [`c962196`](https://github.com/chenxin-yan/crust/commit/c962196c777401f9627ab70bc4453ac5a62a8233), [`555b150`](https://github.com/chenxin-yan/crust/commit/555b1506b4eb0670bb82f8fddb5ec41118d7c257), [`ff01466`](https://github.com/chenxin-yan/crust/commit/ff01466931a7f0616ac01e9ea6be2285f702344f), [`0ce45f4`](https://github.com/chenxin-yan/crust/commit/0ce45f4cd41cc4c9ef4181a23ea6360fd756b49b), [`0ce45f4`](https://github.com/chenxin-yan/crust/commit/0ce45f4cd41cc4c9ef4181a23ea6360fd756b49b), [`0ce45f4`](https://github.com/chenxin-yan/crust/commit/0ce45f4cd41cc4c9ef4181a23ea6360fd756b49b), [`ff01466`](https://github.com/chenxin-yan/crust/commit/ff01466931a7f0616ac01e9ea6be2285f702344f), [`d535dbb`](https://github.com/chenxin-yan/crust/commit/d535dbb64dd0e0a16efb7ed4e6c3c4371484c4a9), [`0ce45f4`](https://github.com/chenxin-yan/crust/commit/0ce45f4cd41cc4c9ef4181a23ea6360fd756b49b), [`26c65bf`](https://github.com/chenxin-yan/crust/commit/26c65bf4be897e715974381a6be1c0367dc38e43), [`4959ae7`](https://github.com/chenxin-yan/crust/commit/4959ae784da8c8097608fc6c1c6cf525662c16e6), [`98cf6d1`](https://github.com/chenxin-yan/crust/commit/98cf6d193ddabdb9f1f9421935698e79bfc8cc6d), [`0ce45f4`](https://github.com/chenxin-yan/crust/commit/0ce45f4cd41cc4c9ef4181a23ea6360fd756b49b), [`49b5d75`](https://github.com/chenxin-yan/crust/commit/49b5d75850ce6c4deb52384f5ad4c240f27f36a7), [`0ce45f4`](https://github.com/chenxin-yan/crust/commit/0ce45f4cd41cc4c9ef4181a23ea6360fd756b49b), [`ff01466`](https://github.com/chenxin-yan/crust/commit/ff01466931a7f0616ac01e9ea6be2285f702344f), [`9963b85`](https://github.com/chenxin-yan/crust/commit/9963b8590cf641f10a76a6ee2b2a5ef80542428b), [`275d6a7`](https://github.com/chenxin-yan/crust/commit/275d6a74dc0095089a5f1769b37a1dbd35b656c8), [`275d6a7`](https://github.com/chenxin-yan/crust/commit/275d6a74dc0095089a5f1769b37a1dbd35b656c8)]:
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
