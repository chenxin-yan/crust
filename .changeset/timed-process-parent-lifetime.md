---
"@crustjs/utils": patch
"@crustjs/crust": patch
---

On POSIX, `runProcess()` with a `timeout` now also kills the child's process group when the calling process receives `SIGINT`, `SIGTERM`, `SIGHUP`, or `SIGQUIT`, or exits synchronously. The call rejects, and the signal is re-raised when no other listener handles it. Previously the detached child and its descendants outlived an interrupted parent. `crust build` uses this for its compiler `--version` probe, so interrupting a build no longer leaves a stuck probe running.
