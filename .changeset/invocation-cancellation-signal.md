---
"@crustjs/core": minor
---

Add an invocation-scoped cancellation signal. Every Command Action, Extension hook context, and `onError` fallback context now carries `signal: AbortSignal`. `execute()` accepts `signal` (caller-owned cancellation) and `sigint: "exit" | "abort"` (default `"exit"`, unchanged behavior; `"abort"` turns the first Ctrl-C into an `AbortError` on `ctx.signal` and lets a second Ctrl-C terminate). `run()` and `handle.run()` take `InvocationOptions` (`stdout`/`stderr` sinks plus `signal`) as their last argument. New exported types: `InvocationOptions`, `ExecuteOptions`, `SigintPolicy`.
