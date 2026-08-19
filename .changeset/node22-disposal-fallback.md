---
"@crustjs/core": patch
---

Fixed a crash on Node 22, where every command invocation failed with `AsyncDisposableStack is not defined`. The global only exists on Bun, Deno, and Node 24+ (V8 13.8); invocations now fall back to a minimal in-package disposal stack when it is absent.
