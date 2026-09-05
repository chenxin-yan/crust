---
"@crustjs/testing": minor
---

Introduce `@crustjs/testing`: application testing helpers with captured output and fake interactive terminals.

- `captureRun(app, path, input?)` drives typed `run()` and returns `CapturedRun` with captured `stdout`/`stderr`: `completed` owns the action's typed `result`, `finished` owns the finishing Extension's `by` identity, and `failed` owns the thrown `error`.
- `captureExecute(app, argv)` drives terminal `execute()` in-process, capturing exit codes (`0`/`1`/`130`), Extension error rendering, and cancellation without subprocesses. It restores `process.exitCode` after capture; `CapturedExecute` names the result. `CaptureIO` and `ExecutableApp` expose the capture contracts.
- `runInteractive(app, path, input?)` provides a fake terminal for prompts and progress indicators. Named keys autocomplete via `keys()` (control keys and printable characters also work); `waitFor()` and `screen()` observe shared prompt/spinner/progress output. `InteractiveRun` names the harness.

Peers are `@crustjs/core` (`^0.2.0` for this release), `@crustjs/prompts`, and `@crustjs/progress`, with optional TypeScript `^7.0.0`. Supported runtimes are Bun 1.3.14+, Node.js 22+, and Deno 2.8+; the package is marked side-effect free.
