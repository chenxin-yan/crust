---
"@crustjs/core": patch
---

Context cleanup no longer constructs new Contexts. Once every setup started during the invocation has settled, pulling a Context that was never built (from a `defer` callback or a fire-and-forget chain left by `postRun`) rejects with a `DEFINITION` `CrustError` whose `details.reason` is `context-during-disposal`, instead of opening a resource on the already-disposing stack and surfacing a raw `ReferenceError` while the value leaks. Already-built values stay readable until they are disposed. The Node 22 disposal-stack fallback is now idempotent: disposing it twice runs each cleanup once, matching the native `AsyncDisposableStack`.
