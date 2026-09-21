---
"@crustjs/effect": minor
---

`handler()` runs the Effect program with the invocation's `ctx.signal`, so aborting it (`execute({ signal })`, `run(path, input, { signal })`, or Ctrl-C under `execute({ sigint: "abort" })`) interrupts the fiber, hands Layer finalizers the interruption Exit, and exits 130 like any other interruption.
