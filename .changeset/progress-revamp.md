---
"@crustjs/progress": minor
---

Rework `@crustjs/progress` around imperative primitives and injectable output (breaking).

- `spinner()` called without a `task` returns an imperative handle whose `start`/`updateMessage`/`stop(outcome, message?)` can live in different call frames, with `stop("error")` rendering the `✗` final line without throwing. New `progress()` — a determinate `(current/total)` indicator with `advance()`. Both accept `sigint: false` to skip the built-in `SIGINT → exit(130)` handler. Task-mode `spinner({ message, task })` behavior is unchanged, and task callbacks still receive `updateMessage`.
- Output is injectable: the `ProgressSink` contract (`{ isTTY, write }`) is a public export, `spinner()` and `progress()` accept a per-call `sink` option, and `withProgressSink(sink, fn)` makes a sink ambiently available in `fn`'s async scope (mirroring `withPromptIO` in `@crustjs/prompts`). Resolution order: per-call `sink` → ambient sink → `process.stderr`; non-TTY sinks receive final lines only.
- Global theme state (`setTheme`, `getTheme`, `createTheme`) and the `SpinnerController` export are removed. Pass theme overrides directly on each `spinner`/`progress` call; resolution is `defaultTheme` ← per-call `theme`.
