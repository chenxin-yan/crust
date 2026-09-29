# @crustjs/progress

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
