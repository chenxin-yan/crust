---
"@crustjs/core": patch
---

Add an invocation-scoped cancellation signal. Every Command Action, Extension hook context, and `onError` fallback context now carries `signal: AbortSignal`. `execute()` accepts `signal` (caller-owned cancellation) and `sigint: "exit" | "abort"` (default `"exit"`, unchanged behavior; `"abort"` turns the first Ctrl-C into an `AbortError` on `ctx.signal`, keeps listening so one-shot handlers such as the `@crustjs/progress` spinner do not re-raise, and lets a second Ctrl-C terminate). A caller signal keeps its own abort reason: an `AbortError` exits 130, anything else renders and exits 1. `run()` and `handle.run()` take `InvocationOptions` (`stdout`/`stderr` sinks plus `signal`) as their last argument. New exported types: `InvocationOptions`, `ExecuteOptions`, `SigintPolicy`.
