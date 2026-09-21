---
"@crustjs/effect": patch
---

`handler()` and `layer()` run the Effect program and Layer builds with the invocation's `ctx.signal`. Caller cancellation or Ctrl-C during `execute()` interrupts the fibers, including interruptible Layer acquisition, and hands Layer finalizers the interruption Exit. Signal interruption becomes an `AbortError` and exits 130 even when the caller supplies a custom abort reason. Cleanup runs without the aborted signal so finalizers can finish.
