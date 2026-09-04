---
"@crustjs/testing": minor
---

Introduce `@crustjs/testing`: application testing helpers with captured output and fake interactive terminals.

- `captureRun(app, path, input?)` drives the typed `run()` pipeline and returns a status-discriminated `CapturedRun` with captured `stdout`/`stderr`: `completed` owns the action's typed `result`, `finished` owns the finishing Extension's `by` identity, and `failed` owns the thrown `error`.
- `captureExecute(app, argv)` drives the terminal `execute()` path in-process: returned exit codes (`0`/`1`/`130`), Extension `onError` rendering, and cancellation are assertable without subprocess probes.
- `runInteractive(app, path, input?)` runs against a fake terminal for prompt-driven flows. `keys()` autocompletes named key names (`ctrl+<letter>` and single printable characters remain accepted), and spinners and progress indicators render onto the fake terminal through the ambient progress sink — `waitFor()` and `screen()` observe them.

`@crustjs/testing` requires `@crustjs/progress` and `@crustjs/prompts` as peer dependencies.
