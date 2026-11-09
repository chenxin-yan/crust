---
"@crustjs/core": minor
---

`execute()` now cancels on `SIGTERM` as well as `SIGINT`. Supervisors such as `docker stop`, Kubernetes, systemd, `timeout`, CI cancellation, and agent harnesses send `SIGTERM`, which used to kill the process on the spot and skip `postRun` hooks, Context disposal, and Effect finalizers. The first `SIGTERM` now aborts `ctx.signal` with an `AbortError` (`Terminated by SIGTERM.`), cleanup runs, and the process exits `143`; Ctrl-C still exits `130`, and so does an aborted `execute({ signal })`. Like Ctrl-C, a second `SIGTERM` within 50 ms counts as the same signal, a later one terminates unless another listener owns it, and a `SIGTERM` the process inherited as ignored stays ignored.

**Behavior change:** a command that ignores `ctx.signal` now keeps running after the first `SIGTERM` until it finishes or a second `SIGTERM` arrives.
