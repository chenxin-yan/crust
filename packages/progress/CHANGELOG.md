# @crustjs/progress

## 0.2.0

### Minor Changes

- [#592](https://github.com/chenxin-yan/crust/pull/592) [`4208178`](https://github.com/chenxin-yan/crust/commit/420817832f065c875e836b86deac832f84d86828) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Spinners and progress indicators without a `sink` or ambient terminal output now write standard error through the same writer as `@crustjs/core`'s default `stderr`, so inside a Command Action they stay in order with the action's `stderr()` lines and restore the cursor even when the process exits right away. Their default colors now follow only their own output, so creating a spinner no longer touches `process.stdout`, and `@crustjs/style` no longer reads `process.stdout` when `overrides.isTTY` is given.
  
  **Behavior change:** on macOS and Linux the default output is written synchronously to file descriptor 2, so replacing `process.stderr.write` no longer captures it. Pass a `sink` or use `withTerminalIO()` to capture spinner output.

- [#567](https://github.com/chenxin-yan/crust/pull/567) [`2821b47`](https://github.com/chenxin-yan/crust/commit/2821b479175e77e513330ac5100b50ac159573a7) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Breaking: `ProgressSink` is renamed to `TerminalOutput`, the same type `@crustjs/prompts` exports, and the `withProgressSink(sink, fn)` alias is removed; use `withTerminalIO({ output: sink }, fn)`.

### Patch Changes

- [#539](https://github.com/chenxin-yan/crust/pull/539) [`ce12aed`](https://github.com/chenxin-yan/crust/commit/ce12aed7a34275c49b54340d1995378afedfa2a6) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Remove the `engines.deno` declaration; Deno is no longer supported.

- [#515](https://github.com/chenxin-yan/crust/pull/515) [`0e52e28`](https://github.com/chenxin-yan/crust/commit/0e52e28cef2b18dd7f9774e14be9083ad9167ba5) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - `spinner({ task })` accepts a synchronous `task` (it returns `T | Promise<T>`) and is typed `Promise<T>`. Previously a stored options object with a synchronous task resolved to the `SpinnerHandle` overload while the call actually returned a promise; the handle overload now requires `task` to be absent.
  
  Also fixes:
  
  - A spinner or progress frame wider than the terminal no longer adds a line on every frame: the animated frame (symbol, message, count, and theme text) is cut to one row with `…` and at its first line break (`progress()` keeps its count when it fits), and the final line prints the full message. Redraws still erase only the spinner's row, so lines the task logs to the same terminal stay on screen.
  - `process.exit()` while an interactive spinner is running restores the cursor when the sink writes synchronously.
  - A theme or sink that throws while drawing the first frame no longer leaves the cursor hidden or an `exit` listener behind.

- [#513](https://github.com/chenxin-yan/crust/pull/513) [`6ef96cd`](https://github.com/chenxin-yan/crust/commit/6ef96cdc8349991ca77360e906f6ae56863cc38b) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Decide default theme colors from the stream a prompt or spinner writes to instead of stdout. Prompts and spinners on a terminal stderr are now colored when stdout is piped, and redirected stderr no longer receives ANSI escapes when stdout is a terminal. `NO_COLOR` and `FORCE_COLOR` apply as before; theme functions you pass are unchanged.

- [#589](https://github.com/chenxin-yan/crust/pull/589) [`db2f5b3`](https://github.com/chenxin-yan/crust/commit/db2f5b391ccbcc6750e98e9219511ecf0820baf6) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Add `createPlainStyle()`: plain style functions (`bold`, `red`, …) with fixed settings. It takes the same options as `createStyle()` and gives the same output, without chaining, `open`/`close`, or `fg`/`bg`, so importing it does not bundle the chain engine. Pass `overrides: { isTTY }` to decide color for a stream other than stdout. Its return type, `PlainStyle`, is exported.
  
  The default themes of `@crustjs/prompts` and `@crustjs/progress` use it to decide color from their own output stream, so apps that use prompts or spinners no longer bundle the chain engine. Output is unchanged.
- Updated dependencies [[`6fdb8a6`](https://github.com/chenxin-yan/crust/commit/6fdb8a642b79a176d60d9a3d4be3431493201052), [`ce12aed`](https://github.com/chenxin-yan/crust/commit/ce12aed7a34275c49b54340d1995378afedfa2a6), [`ce12aed`](https://github.com/chenxin-yan/crust/commit/ce12aed7a34275c49b54340d1995378afedfa2a6), [`643beb2`](https://github.com/chenxin-yan/crust/commit/643beb264f5b206177110dd947b258f47cc68073), [`708e181`](https://github.com/chenxin-yan/crust/commit/708e181f0de97b81b77d64261f754e2649af1761), [`4a4386d`](https://github.com/chenxin-yan/crust/commit/4a4386d64fdef5440e77cebd8b9ac85e7a1d7350), [`4208178`](https://github.com/chenxin-yan/crust/commit/420817832f065c875e836b86deac832f84d86828), [`d64f307`](https://github.com/chenxin-yan/crust/commit/d64f30727fd3d28dcb26b7edeb6aed929a3efe19), [`e802ec7`](https://github.com/chenxin-yan/crust/commit/e802ec7c09c6635d77716e3c1c545faa99fe7759), [`db2f5b3`](https://github.com/chenxin-yan/crust/commit/db2f5b391ccbcc6750e98e9219511ecf0820baf6), [`6ef96cd`](https://github.com/chenxin-yan/crust/commit/6ef96cdc8349991ca77360e906f6ae56863cc38b), [`bc85878`](https://github.com/chenxin-yan/crust/commit/bc858780958074fad17424509e5a4190e5e7d468), [`f49de57`](https://github.com/chenxin-yan/crust/commit/f49de57eb0d77220617792669fb185f1e20e656d), [`6ce95ed`](https://github.com/chenxin-yan/crust/commit/6ce95edb85095d8e8c3ab27fed8226d320fc3d82), [`7811b12`](https://github.com/chenxin-yan/crust/commit/7811b12f73827e1d47a1574c4b88736eb82632b0), [`3a6dbb1`](https://github.com/chenxin-yan/crust/commit/3a6dbb1702cff684c17054cd476ddef0b5d56f99)]:
  - @crustjs/utils@0.3.0
  - @crustjs/style@0.4.0

## 0.1.5

### Patch Changes

- [#484](https://github.com/chenxin-yan/crust/pull/484) [`1f7b266`](https://github.com/chenxin-yan/crust/commit/1f7b26648e412d0c6170c2866fb6ec97aa907f14) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Update the package description shown on npm and in the README.
- Updated dependencies [[`1f7b266`](https://github.com/chenxin-yan/crust/commit/1f7b26648e412d0c6170c2866fb6ec97aa907f14)]:
  - @crustjs/style@0.3.6

## 0.1.4

### Patch Changes

- [#469](https://github.com/chenxin-yan/crust/pull/469) [`1984299`](https://github.com/chenxin-yan/crust/commit/1984299962d29641ed1b9741f1ed252a1b3f8e1b) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Raise the minimum supported Node.js version to 24. Remove the Node 22 disposal-stack fallback and use native AsyncDisposableStack on all supported runtimes. Update generated Node projects to require Node 24 and use @types/node 24.
- Updated dependencies [[`1984299`](https://github.com/chenxin-yan/crust/commit/1984299962d29641ed1b9741f1ed252a1b3f8e1b)]:
  - @crustjs/style@0.3.5
  - @crustjs/utils@0.2.1

## 0.1.3

### Patch Changes

- [#463](https://github.com/chenxin-yan/crust/pull/463) [`c6f4bd8`](https://github.com/chenxin-yan/crust/commit/c6f4bd8f3de3558d9c988acf63830ec899cf6854) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Restore the terminal cursor when final spinner rendering or output throws
- Updated dependencies [[`0da2c5c`](https://github.com/chenxin-yan/crust/commit/0da2c5ce54f71acc5d51fad1dcb2c5546a71948e), [`c6f4bd8`](https://github.com/chenxin-yan/crust/commit/c6f4bd8f3de3558d9c988acf63830ec899cf6854), [`4360cb1`](https://github.com/chenxin-yan/crust/commit/4360cb1cefca245e76967ade43c82b5361c039e5), [`4977f33`](https://github.com/chenxin-yan/crust/commit/4977f33e87a928d968202af40f9729e390b7df93), [`4977f33`](https://github.com/chenxin-yan/crust/commit/4977f33e87a928d968202af40f9729e390b7df93)]:
  - @crustjs/utils@0.2.0
  - @crustjs/style@0.3.4

## 0.1.2

### Patch Changes

- [#411](https://github.com/chenxin-yan/crust/pull/411) [`2cbdc21`](https://github.com/chenxin-yan/crust/commit/2cbdc2122f7bffbad42b79185bf0e4d8d97021a7) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Depend on the published `@crustjs/utils` package instead of inlining its sources into the bundle.
- Updated dependencies [[`2cbdc21`](https://github.com/chenxin-yan/crust/commit/2cbdc2122f7bffbad42b79185bf0e4d8d97021a7)]:
  - @crustjs/utils@0.1.0

## 0.1.1

### Patch Changes

- [#371](https://github.com/chenxin-yan/crust/pull/371) [`d103a76`](https://github.com/chenxin-yan/crust/commit/d103a7688dd3240c913596e46f6100b772ded80d) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Raise the supported Bun floor to 1.4.0.
  
  Every package now declares `engines.bun` as `>=1.4.0`, and Bun 1.3 is no longer tested. Bun 1.4 ships a single x64 binary, which is what lets `crust build` use the canonical `bun-linux-x64` and `bun-windows-x64` target names.
- Updated dependencies [[`d103a76`](https://github.com/chenxin-yan/crust/commit/d103a7688dd3240c913596e46f6100b772ded80d)]:
  - @crustjs/style@0.3.1

## 0.1.0

### Minor Changes

- [#307](https://github.com/chenxin-yan/crust/pull/307) [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Breaking: imperative progress indicators and injectable output.
  
  - `spinner()` without `task` returns a `SpinnerHandle` with `start()`, `updateMessage()`, and `stop(outcome?, message?)`. `stop("error")` renders the failure line without throwing; stopping before starting still renders a final line. New `progress({ total, message })` returns a `ProgressHandle` with `advance(amount?, message?)`, rendering `(current/total)`. Task-mode spinners still pass `updateMessage` to the callback.
  - Interactive indicators restore the cursor on SIGINT and re-raise the signal instead of calling `process.exit(130)`. If the host retains a SIGINT listener, termination is left to it. Pass `sigint: false` to install no handler and perform your own cleanup.
  - `spinner`/`progress` accept a per-call `sink`: `ProgressSink` is writable-compatible (`{ write, isTTY?, columns? }`). `withTerminalIO(io, fn)` shares ambient output with prompts; `withProgressSink(sink, fn)` is an output-only alias. Resolution is per-call sink → ambient output → `process.stderr`; non-TTY output receives final lines only.
  - Global theme APIs `setTheme`, `getTheme`, and `createTheme` are removed; pass `theme` per call over `defaultTheme`. `SpinnerController` is removed; the task callback takes `Pick<SpinnerHandle, "updateMessage">`.
  - New public types: `SpinnerHandle`, `SpinnerHandleOptions`, `SpinnerOutcome`, `SpinnerSigintPolicy`, `ProgressHandle`, `ProgressOptions`, `ProgressSink`, and `TerminalIO`.

- [#307](https://github.com/chenxin-yan/crust/pull/307) [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Update runtime compatibility and package builds.
  
  - Libraries support Bun 1.3.14+, Node.js 22+, and Deno 2.8+ (`engines` updated). Context disposal includes a fallback for runtimes without `AsyncDisposableStack`, including Node 22/23. The `crust` build CLI remains Bun tooling; its npm distribution ships standalone executables with Bun embedded.
  - Published packages no longer depend on `@crustjs/utils`; its helpers are bundled. `@crustjs/store` also drops `@standard-schema/spec`. Library packages and `create-crust` are marked `sideEffects: false` for bundlers.
  - Packages shipping declarations declare an optional TypeScript `^7.0.0` peer; builder inference is supported on TypeScript 7. JavaScript consumers are unaffected by this compiler requirement.

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
