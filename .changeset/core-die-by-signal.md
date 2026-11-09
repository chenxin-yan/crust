---
"@crustjs/core": patch
---

A run that Ctrl-C (`SIGINT`) or `SIGTERM` cancelled now ends by that signal. Once the action, `postRun` hooks, Context disposal, and failure rendering finish, `execute()` re-raises the signal, so the process dies by it and shells report `130` / `143`. A Ctrl-C now stops a shell loop such as `for p in a b c; do cli build $p; done`, which only stops for a child killed by `SIGINT`. `process.exitCode` is also set to `130` / `143`, and is the exit status when another listener still owns the signal, on Windows, or when `execute({ io })` captures output in-process (tests and `@crustjs/testing` never re-raise). An aborted `execute({ signal })` still exits `130` without re-raising. A signal that arrives while synchronous work blocks the event loop is no longer dropped when that work returns: the run ends by it instead of exiting `0`.

**Behavior change:** an action that ignores `ctx.signal` and completes (or fails) after the first `SIGINT`/`SIGTERM` no longer exits `0` (or `1`); it ends by the signal with `130` / `143`. Code after `await app.execute()` no longer runs after such a signal.
