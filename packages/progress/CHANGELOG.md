# @crustjs/progress

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
