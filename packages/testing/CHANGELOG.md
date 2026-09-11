# @crustjs/testing

## 0.1.0

### Minor Changes

- [#355](https://github.com/chenxin-yan/crust/pull/355) [`7d72b4c`](https://github.com/chenxin-yan/crust/commit/7d72b4cfd235517e941e9384516a80f8dfa74e95) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Make core `run()` quiet and captured by default. Every `RunOutcome` includes `stdout` and `stderr`; completed outcomes carry the typed action result, finished outcomes identify the Extension, and failed outcomes retain the original escaping error and partial output after cleanup. Invocation failures now resolve to `failed` instead of rejecting. Optional IO callbacks forward live output once while retaining capture. `execute()` remains the streaming terminal adapter with error presentation and exit codes.
  
  Remove `captureRun` and `CapturedRun` from `@crustjs/testing`: call `app.run(path, input)` directly. Keep `captureExecute` for terminal semantics. `runInteractive` explicitly propagates failed core outcomes through `done` and `waitFor`, including primitive thrown values.

- [#142](https://github.com/chenxin-yan/crust/pull/142) [`c679228`](https://github.com/chenxin-yan/crust/commit/c679228436d00a398c103142762ee89381e44836) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Introduce `@crustjs/testing`: application testing helpers with captured output and fake interactive terminals.
  
  - `captureExecute(app, argv)` drives terminal `execute()` in-process, capturing exit codes (`0`/`1`/`130`), Extension error rendering, and cancellation without subprocesses. It restores `process.exitCode` after capture; `CapturedExecute` names the result. `CaptureIO` and `ExecutableApp` expose the capture contracts.
  - `runInteractive(app, path, input?)` provides a fake terminal for prompts and progress indicators. Named keys autocomplete via `keys()` (control keys and printable characters also work); `waitFor()` and `screen()` observe shared prompt/spinner/progress output. `InteractiveRun` names the harness. Failed core outcomes reject `done` and unmatched `waitFor` calls with their original errors; ordinary capture uses core `app.run()`.
  
  Peers are `@crustjs/core` (`^0.2.0` for this release), `@crustjs/prompts`, and `@crustjs/progress`, with optional TypeScript `^7.0.0`. Supported runtimes are Bun 1.3.14+, Node.js 22+, and Deno 2.8+; the package is marked side-effect free.

### Patch Changes

- Updated dependencies [[`0b0aeca`](https://github.com/chenxin-yan/crust/commit/0b0aecaed104b6ee548ae01f589c71c44a2eb9bc), [`7d72b4c`](https://github.com/chenxin-yan/crust/commit/7d72b4cfd235517e941e9384516a80f8dfa74e95), [`38e7298`](https://github.com/chenxin-yan/crust/commit/38e7298954c60ec0a45dcfa830b515b2bc32ece0), [`cc466b5`](https://github.com/chenxin-yan/crust/commit/cc466b5a0b5792d4811e85d82e341980bc1fb606), [`7d72b4c`](https://github.com/chenxin-yan/crust/commit/7d72b4cfd235517e941e9384516a80f8dfa74e95), [`7d72b4c`](https://github.com/chenxin-yan/crust/commit/7d72b4cfd235517e941e9384516a80f8dfa74e95), [`cb0e9f1`](https://github.com/chenxin-yan/crust/commit/cb0e9f1f0538c0576505534d429566ed29bcb996), [`37a4ae1`](https://github.com/chenxin-yan/crust/commit/37a4ae15d7cc635406ad2f7643afaad6d7391e75), [`72b462e`](https://github.com/chenxin-yan/crust/commit/72b462e110c421ce453b7a2f81ef0e284f908607), [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce), [`7d72b4c`](https://github.com/chenxin-yan/crust/commit/7d72b4cfd235517e941e9384516a80f8dfa74e95)]:
  - @crustjs/core@0.2.0
