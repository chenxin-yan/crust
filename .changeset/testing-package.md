---
"@crustjs/testing": minor
---

Introduce `@crustjs/testing`: application testing helpers with captured output and fake interactive terminals.

- `captureExecute(app, argv)` drives terminal `execute()` in-process, capturing exit codes (`0`/`1`/`130`), Extension error rendering, and cancellation without subprocesses. It restores `process.exitCode` after capture; `CapturedExecute` names the result. `CaptureIO` and `ExecutableApp` expose the capture contracts.
- `runInteractive(app, path, input?)`, exported from `@crustjs/testing/interactive`, provides a fake terminal for prompts and progress indicators. Named keys autocomplete via `keys()` (control keys and printable characters also work); `waitFor()` and `screen()` observe shared prompt/spinner/progress output. `InteractiveRun` names the harness. Failed core outcomes reject `done` and unmatched `waitFor` calls with their original errors; ordinary capture uses core `app.run()`.

`@crustjs/core` (`^0.2.0` for this release) is a required peer. `@crustjs/prompts` is an optional peer used only by `@crustjs/testing/interactive`; the root entry point imports nothing from it. `@crustjs/progress` is not a peer: progress output reaches the fake terminal through the ambient `withTerminalIO` scope. TypeScript `^7.0.0` is an optional peer. Supported runtimes are Bun 1.3.14+, Node.js 22+, and Deno 2.8+; the package is marked side-effect free.
