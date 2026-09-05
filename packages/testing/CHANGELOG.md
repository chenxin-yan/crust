# @crustjs/testing

## 0.1.0

### Minor Changes

- [#142](https://github.com/chenxin-yan/crust/pull/142) [`c679228`](https://github.com/chenxin-yan/crust/commit/c679228436d00a398c103142762ee89381e44836) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Introduce `@crustjs/testing`: application testing helpers with captured output and fake interactive terminals.
  
  - `captureRun(app, path, input?)` drives typed `run()` and returns `CapturedRun` with captured `stdout`/`stderr`: `completed` owns the action's typed `result`, `finished` owns the finishing Extension's `by` identity, and `failed` owns the thrown `error`.
  - `captureExecute(app, argv)` drives terminal `execute()` in-process, capturing exit codes (`0`/`1`/`130`), Extension error rendering, and cancellation without subprocesses. It restores `process.exitCode` after capture; `CapturedExecute` names the result. `CaptureIO` and `ExecutableApp` expose the capture contracts.
  - `runInteractive(app, path, input?)` provides a fake terminal for prompts and progress indicators. Named keys autocomplete via `keys()` (control keys and printable characters also work); `waitFor()` and `screen()` observe shared prompt/spinner/progress output. `InteractiveRun` names the harness.
  
  Peers are `@crustjs/core` (`^0.2.0` for this release), `@crustjs/prompts`, and `@crustjs/progress`, with optional TypeScript `^7.0.0`. Supported runtimes are Bun 1.3.14+, Node.js 22+, and Deno 2.8+; the package is marked side-effect free.

### Patch Changes

- Updated dependencies [[`cc466b5`](https://github.com/chenxin-yan/crust/commit/cc466b5a0b5792d4811e85d82e341980bc1fb606), [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce)]:
  - @crustjs/core@0.2.0
