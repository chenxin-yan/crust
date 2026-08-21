# @crustjs/progress

## 0.1.0

### Minor Changes

- [#307](https://github.com/chenxin-yan/crust/pull/307) [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Rework `@crustjs/progress` around imperative primitives and injectable output (breaking).
  
  - `spinner()` called without a `task` returns an imperative handle whose `start`/`updateMessage`/`stop(outcome, message?)` can live in different call frames, with `stop("error")` rendering the `✗` final line without throwing. New `progress()` — a determinate `(current/total)` indicator with `advance()`. Both accept `sigint: false` to skip the built-in `SIGINT → exit(130)` handler. Task-mode `spinner({ message, task })` behavior is unchanged, and task callbacks still receive `updateMessage`.
  - Output is injectable: the `ProgressSink` contract (`{ isTTY, write }`) is a public export, `spinner()` and `progress()` accept a per-call `sink` option, and `withProgressSink(sink, fn)` makes a sink ambiently available in `fn`'s async scope (mirroring `withPromptIO` in `@crustjs/prompts`). Resolution order: per-call `sink` → ambient sink → `process.stderr`; non-TTY sinks receive final lines only.
  - Global theme state (`setTheme`, `getTheme`, `createTheme`) and the `SpinnerController` export are removed. Pass theme overrides directly on each `spinner`/`progress` call; resolution is `defaultTheme` ← per-call `theme`.

- [#307](https://github.com/chenxin-yan/crust/pull/307) [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Modernize the runtime support matrix and package builds.
  
  - Supported runtimes: Bun 1.3.14+, Node.js 22+, and Deno 2.8+. Package runtime code is portable across all three — Bun globals are replaced with Node-compatible built-ins, and process spawning uses `node:child_process`. On runtimes without `AsyncDisposableStack` (Node 22/23), invocations fall back to an in-package disposal stack.
  - Package builds migrate to tsdown (Rolldown) and modules are marked side-effect free. Internal `@crustjs/utils` imports are inlined, fixing `@crustjs/store` installs that previously required `@crustjs/utils` at runtime. Consumers bundling with Bun 1.3.10–1.3.13 may encounter oven-sh/bun#27709 when tree-shaking packages with `sideEffects: false`.
  - All packages that ship type declarations declare an optional `typescript: "^7.0.0"` peerDependency. Builder inference performance is measured and supported against the native TypeScript 7 compiler; plain-JavaScript consumers are unaffected.

### Patch Changes

- Updated dependencies [[`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce), [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce)]:
  - @crustjs/style@0.3.0

## 0.0.4

### Patch Changes

- Updated dependencies [075490b]
- Updated dependencies [075490b]
- Updated dependencies [82f5ad6]
  - @crustjs/style@0.2.0

## 0.0.3

### Patch Changes

- Updated dependencies [df08a3a]
- Updated dependencies [df08a3a]
- Updated dependencies [67a9f25]
  - @crustjs/style@0.1.0

## 0.0.2

### Patch Changes

- 341f3b1: Add a new `@crustjs/progress` package and move the canonical `spinner()` implementation there.

  `@crustjs/prompts` now temporarily re-exports `spinner` and related types as deprecated compatibility exports, with removal planned for `v0.1.0`.

  Update internal consumers and docs to use `@crustjs/progress` as the new home for spinner-based progress UI.
