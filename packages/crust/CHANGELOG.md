# @crustjs/crust

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

- [#144](https://github.com/chenxin-yan/crust/pull/144) [`4e4af76`](https://github.com/chenxin-yan/crust/commit/4e4af76a7236f64ee843504126d09efb799d54ce) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Add inert reusable command definitions with `defineCommand(name, requirements?, recipe)` and checked mounting with the variadic `.mount(...definitions)`.

  A definition carries its own name and lists the Context capabilities it needs from its mount site in a plain `requires` array. Every requirement is checked at the `.mount()` call — compile-time for missing or incompatible Context values, and at runtime for required Context names missing from the parent path. Every mount materializes a fresh command under the definition's carried name; use `.as(newName)` to mount one definition under multiple names or parents, and definitions can `.mount()` other definitions.

  Remove `.sub()`, `.command(name, callback)`, `.command(builder)`, and the exported `ChildCrust` type. One-off inline commands are `.mount(defineCommand("up", (command) => ...))`.

  Migration:

  ```ts
  // Before
  const deploy = parent.sub("deploy").handle(({ flags, ctx }) => {});
  const app = parent.command(deploy);

  // After
  const verbose = defineFlag("verbose", { type: "boolean" });
  const logging = defineContext(
    "logging",
    { flags: [verbose] },
    ({ flags }) => flags
  );
  const auth = defineContext("auth", () => createAuthClient());

  const deploy = defineCommand(
    "deploy",
    { requires: [logging, auth] },
    (command) => command.handle(({ ctx }) => {})
  );

  const app = parent.provide(logging(), auth()).mount(deploy);
  const shipToo = parent.mount(deploy.as("ship"));
  ```

  Provide required Context capabilities with `.provide()` on the parent builder before `.mount()`. Extension-contributed commands are unchanged.

- [#139](https://github.com/chenxin-yan/crust/pull/139) [`0ce45f4`](https://github.com/chenxin-yan/crust/commit/0ce45f4cd41cc4c9ef4181a23ea6360fd756b49b) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Documentation consolidation: package READMEs are now concise stubs linking to the docs site (crustjs.com), unique README content moved into the docs, and public option/type TSDoc was enriched (descriptions, `@default` tags) to back generated API reference tables. No runtime behavior changes.

- [#139](https://github.com/chenxin-yan/crust/pull/139) [`0ce45f4`](https://github.com/chenxin-yan/crust/commit/0ce45f4cd41cc4c9ef4181a23ea6360fd756b49b) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Remove the unused `isGitInstalled` API and simplify scaffolding, build, path, and persistence internals.

## 0.0.24

### Patch Changes

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

## 0.0.23

### Patch Changes

- f457387: Prefer spawning real `bun build --compile` over in-process `Bun.build()` to avoid standalone compiler failures on some host/target combinations.
  - Add `resolveBunBuildRunner()` to prefer the real Bun binary on PATH, falling back to `process.execPath` with `BUN_BE_BUN=1` only when needed
  - Update `execBuild()` to always use subprocess compilation instead of the programmatic API
  - Improve error reporting by surfacing both stdout and stderr from failed builds
  - Add unit tests for the new runner resolution logic
  - Update documentation to reflect the new build behavior

## 0.0.22

### Patch Changes

- 662c53c: migrate to use js resolver instead of shell resolver so that it will expose single entry point

## 0.0.21

### Patch Changes

- 1433928: Add `--env-file` flag to `crust build` for loading environment files at build time. Public env vars (PUBLIC\_\*) are automatically inlined as build-time constants.
- 86e09aa: Rename `--distribute` build flag to `--package` across CLI, templates, and docs

## 0.0.20

### Patch Changes

- a69c4d9: Add per-platform npm distribution workflow with `crust build --distribute` and `crust publish` commands. The build command now supports `--distribute` and `--stage-dir` flags to stage per-OS/arch npm packages with platform-specific binaries and shell/cmd resolvers. The new `publish` command publishes staged packages in dependency order. Updated `create-crust` binary distribution template to use the new distribute/publish workflow.

## 0.0.19

### Patch Changes

- 38cdb75: Fix Windows ARM64 binary never selected in .cmd resolver due to CMD parse-time variable expansion

## 0.0.18

### Patch Changes

- 254b262: Add Windows ARM64 support to `crust build` and update distribution outputs.
  - `crust build` now supports `windows-arm64` (`bun-windows-arm64`) as a compile target.
  - Windows resolver generation now selects the correct binary for ARM64 and x64 hosts.
  - Binary distribution templates and package metadata now explicitly include resolver files and compiled binaries.
  - Build docs were updated to include the new Windows ARM64 target and output artifact.

## 0.0.17

### Patch Changes

- Updated dependencies [9f81bcc]
- Updated dependencies [72ea166]
- Updated dependencies [7dc9ede]
  - @crustjs/core@0.0.11
  - @crustjs/plugins@0.0.14

## 0.0.16

### Patch Changes

- Updated dependencies [1715c81]
  - @crustjs/plugins@0.0.13

## 0.0.15

### Patch Changes

- 96ca6b2: Adopt the new builder-style command API across core and official packages, including inherited flags, lifecycle hooks, plugin usage, and command metadata improvements. Update related tooling, templates, and documentation to align with the new command authoring flow.
- Updated dependencies [96ca6b2]
  - @crustjs/core@0.0.10
  - @crustjs/plugins@0.0.12

## 0.0.14

### Patch Changes

- cae6ea2: Add `updateNotifierPlugin` to `@crustjs/plugins`. The plugin checks the npm registry for newer versions of your package and displays a non-blocking update notice after command execution. It is non-persistent by default, supports optional cache adapters (including `@crustjs/store`) for cross-run caching and dedupe, and uses package-manager-aware update commands with override support. Adopted in the `crust` CLI and the `create-crust` scaffold template by default.
- Updated dependencies [cae6ea2]
  - @crustjs/plugins@0.0.11

## 0.0.13

### Patch Changes

- a1f233e: Enable minification for all package builds, reducing bundle sizes by ~27%. Also shorten error messages in `@crustjs/core` for smaller output.
- e3624b2: Add pre-compile validation to `crust build`. Before compiling, the build command now spawns your entry file in a validation-only subprocess to check the full command tree (including plugin-injected flags and subcommands) for definition errors such as flag alias collisions and reserved `no-` prefix misuse. Disable with `--no-validate`.
- Updated dependencies [a1f233e]
- Updated dependencies [e3624b2]
  - @crustjs/core@0.0.9
  - @crustjs/plugins@0.0.10
  - @crustjs/style@0.0.4

## 0.0.12

### Patch Changes

- Updated dependencies [384e2a9]
  - @crustjs/core@0.0.8
  - @crustjs/plugins@0.0.9

## 0.0.11

### Patch Changes

- Updated dependencies [1364768]
  - @crustjs/core@0.0.7
  - @crustjs/plugins@0.0.8

## 0.0.10

### Patch Changes

- Updated dependencies [fe4d64d]
  - @crustjs/plugins@0.0.7

## 0.0.9

### Patch Changes

- 2d05fb1: Fix shell resolver failing to locate prebuilt binaries when invoked via symlink (e.g. from `node_modules/.bin/`). The resolver now follows symlinks to resolve the real script directory before looking up platform binaries.

## 0.0.8

### Patch Changes

- 8c11cd0: Replace `Bun.spawn` with programmatic `Bun.build()` API for compilation, enabling self-compiled standalone crust binaries that can compile user CLIs without a separate Bun installation. Add `--outdir/-d` flag for configurable output directory. Update resolver shebang to `#!/usr/bin/env bash`.

## 0.0.7

### Patch Changes

- b415f81: **BREAKING:** Remove re-exports from `@crustjs/crust` — it is now a CLI-only package.

  `@crustjs/crust` no longer re-exports APIs from `@crustjs/core` and `@crustjs/plugins`. It now provides only the `crust` CLI binary (e.g., `crust build`) and should be installed as a dev dependency. Import framework APIs directly from `@crustjs/core` and `@crustjs/plugins` instead.

  Migration: replace `import { defineCommand, runMain, helpPlugin } from "@crustjs/crust"` with `import { defineCommand, runMain } from "@crustjs/core"` and `import { helpPlugin } from "@crustjs/plugins"`. Move `@crustjs/crust` to `devDependencies` and add `@crustjs/core` + `@crustjs/plugins` to `dependencies`.

- 3b00b1d: Add `--resolver` (`-r`) flag to `crust build` for customizing the resolver script filename. Defaults to `cli` instead of `<name>.js`.
- 717180a: Replace Node.js resolver with POSIX shell script and Windows `.cmd` batch file for multi-target builds. The resolver no longer requires Node.js or Bun to dispatch to the correct platform binary.

## 0.0.6

### Patch Changes

- Updated dependencies [8c23587]
  - @crustjs/core@0.0.6
  - @crustjs/plugins@0.0.6

## 0.0.5

### Patch Changes

- 8e0b48a: Fix published package metadata containing unresolved workspace and catalog protocols by switching to bun publish
- Updated dependencies [8e0b48a]
  - @crustjs/core@0.0.5
  - @crustjs/plugins@0.0.5

## 0.0.4

### Patch Changes

- dcc258c: switch to use literal string for flags and args types
- Updated dependencies [115d396]
- Updated dependencies [9b951e9]
- Updated dependencies [bdd101f]
- Updated dependencies [dcc258c]
  - @crustjs/core@0.0.4
  - @crustjs/plugins@0.0.4

## 0.0.3

### Patch Changes

- Update domain to crustjs.com, update dependencies, add homepage, and remove flaky cross-compilation tests
- Updated dependencies
  - @crustjs/core@0.0.3
  - @crustjs/plugins@0.0.3
