# @crustjs/crust

## 0.2.0

### Minor Changes

- [#307](https://github.com/chenxin-yan/crust/pull/307) [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Unify build-time artifact generation behind Extension build hooks and a single snapshot protocol.
  
  - Extensions can expose a `build(ctx)` hook for build-time artifact generation. The context carries the frozen root Command Snapshot and a resolved absolute output directory; snapshots are refreshed between hooks so later generators see sections derived from earlier hooks' outputs.
  - `crust build` runs build hooks from every registered Extension in registration order. Extension presence is the source of intent — the `--man` flag is removed, and `--no-validate` is the single opt-out that skips entry preparation and all build hooks. npm package staging includes every top-level artifact directory emitted by hooks; the name `bin` is reserved for generated npm executables.
  - Build validation and artifact generation share one subprocess-only snapshot-file protocol. `@crustjs/core/tooling` exports `SNAPSHOT_PATH_ENV` (replacing `VALIDATION_MODE_ENV` and `VALIDATION_FORCE_EXIT_ENV`), and man-page generation no longer requires the entry module to export its app. Entries that never call `await app.execute()` previously passed validation vacuously; they now fail with an actionable missing-snapshot error (use `--no-validate` if intentional).
  - New `man(options?)` in `@crustjs/man` is a build-only Extension that writes an mdoc page under the build output's `man` directory. Section 1 is the default; `man({ section })` selects another section and `man({ name })` sets the installed command name. `writeManPage()` remains for custom pipelines and accepts a prepared Command Snapshot as `root` instead of a live app.
  - The `skill()` Extension in `@crustjs/skills` contributes a build hook that writes packaged skills under the build output's `skills` directory: it copies an available packaged source wholesale and otherwise renders from the prepared Command Snapshot.
  - Add first-class Bun, Deno, and Node build runtimes. Projects can persist `crust.runtime` in package.json or override it with `--runtime`; Deno produces standalone executables and Node produces executable bundled JavaScript.
  - `--target` accepts canonical Bun target names only. Replace short names such as `linux-x64` and `darwin-arm64` with `bun-linux-x64-baseline` and `bun-darwin-arm64`.
  - Make build option validation deterministic through a reusable build plan and consistently reject malformed project package manifests. Fix create-crust workspace version inputs, declaratively validate distribution choices, and avoid announcing overwrites before confirmation.
  - Run Windows `.cmd` and `.bat` subprocess shims through the platform shell so Crust builds and create package install and Git steps work with Node's CVE-2024-27980 hardening.

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

- [#307](https://github.com/chenxin-yan/crust/pull/307) [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Modernize the runtime support matrix and package builds.
  
  - Supported runtimes: Bun 1.3.14+, Node.js 22+, and Deno 2.8+. Package runtime code is portable across all three — Bun globals are replaced with Node-compatible built-ins, and process spawning uses `node:child_process`. On runtimes without `AsyncDisposableStack` (Node 22/23), invocations fall back to an in-package disposal stack.
  - Package builds migrate to tsdown (Rolldown) and modules are marked side-effect free. Internal `@crustjs/utils` imports are inlined, fixing `@crustjs/store` installs that previously required `@crustjs/utils` at runtime. Consumers bundling with Bun 1.3.10–1.3.13 may encounter oven-sh/bun#27709 when tree-shaking packages with `sideEffects: false`.
  - All packages that ship type declarations declare an optional `typescript: "^7.0.0"` peerDependency. Builder inference performance is measured and supported against the native TypeScript 7 compiler; plain-JavaScript consumers are unaffected.

### Patch Changes

- [#327](https://github.com/chenxin-yan/crust/pull/327) [`3526708`](https://github.com/chenxin-yan/crust/commit/3526708b3e95c214c4142c31caa106f845bd2fa4) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Copy common `LICENSE.md`, `LICENCE`, and `LICENCE.md` variants into staged distribution packages in addition to `LICENSE`.

- [#336](https://github.com/chenxin-yan/crust/pull/336) [`189f89c`](https://github.com/chenxin-yan/crust/commit/189f89c734664138e3873b299cd5104907f8ed8b) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Route build and publish output through invocation IO, reuse build plans across distribution staging, and prevent captured executions from leaking their exit code to the process.

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
