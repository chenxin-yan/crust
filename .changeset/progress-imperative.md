---
"@crustjs/progress": minor
---

New primitives: `createSpinner()` — an imperative spinner handle whose `start`/`updateMessage`/`stop(outcome, message?)` can live in different call frames, with `stop("error")` rendering the `✗` final line without throwing — and `createProgress()` — a determinate `(current/total)` indicator with `advance()`. Both (and `spinner()`) accept `sigint: false` to skip the built-in `SIGINT → exit(130)` handler so applications can own cancellation cleanup. `spinner()` is now implemented on top of `createSpinner()`; its behavior is unchanged.
