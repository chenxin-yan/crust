---
"@crustjs/progress": minor
---

New primitives: `spinner()` called without a `task` now returns an imperative handle whose `start`/`updateMessage`/`stop(outcome, message?)` can live in different call frames, with `stop("error")` rendering the `✗` final line without throwing — and `progress()` — a determinate `(current/total)` indicator with `advance()`. Both modes accept `sigint: false` to skip the built-in `SIGINT → exit(130)` handler so applications can own cancellation cleanup. Task-mode `spinner({ message, task })` behavior is unchanged.
