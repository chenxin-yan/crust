---
"@crustjs/core": patch
---

Context cleanup no longer constructs new Contexts. Once every setup started during the invocation has settled, pulling a Context that was never built (from a `defer` callback or a fire-and-forget chain left by `postRun`) rejects with a `DEFINITION` `CrustError` whose `details.reason` is `context-during-disposal`, instead of opening a resource on the already-disposing stack and surfacing a raw `ReferenceError` while the value leaks. Promises for Contexts already built keep resolving during cleanup; whether the value is still live depends on `defer` registration order. The Node 22 disposal-stack fallback is now idempotent: disposing it twice runs each cleanup once, matching the native `AsyncDisposableStack`.

`.execute()` no longer drops a cleanup failure that follows a rendered action or `preRun` failure: the disposal side of the escaping `SuppressedError` is written to `stderr` as `Cleanup failed: message` lines without calling `onError` again, and a cancelled action whose cleanup fails exits `1` as before. Core's default renderer lists the members of a `SuppressedError` chain or `AggregateError` (including the Node 22 fallback's aggregate) instead of printing a bare `Error: ` for their blank or boilerplate messages, and it terminates on self-referential or throwing-getter values. `run()` outcomes are unchanged.
