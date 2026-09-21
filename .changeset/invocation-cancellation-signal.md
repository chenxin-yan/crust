---
"@crustjs/core": minor
---

Add an invocation-scoped cancellation signal. Every Command Action, Extension hook context, and `onError` fallback context now carries `signal: AbortSignal`. `execute()` accepts a caller-owned `signal` and handles Ctrl-C automatically: the first Ctrl-C aborts `ctx.signal` with an `AbortError`, allowing cooperative work to stop and cleanup to run; a second terminates unless another listener owns the signal. This changes the previous immediate-termination behavior: work that ignores the signal requires a second Ctrl-C to force-quit. The listener stays registered until the invocation settles so one-shot handlers such as the `@crustjs/progress` spinner defer to Core. A caller signal keeps its own abort reason: an `AbortError` exits 130, anything else renders and exits 1. `run()` and `handle.run()` take `InvocationOptions` (`stdout`/`stderr` sinks plus `signal`) as their last argument. New exported types: `InvocationOptions`, `ExecuteOptions`.
