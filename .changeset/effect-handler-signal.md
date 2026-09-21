---
"@crustjs/effect": patch
---

`handler()` runs the Effect program with the invocation's `ctx.signal`, so aborting it (`execute({ signal })`, `run(path, input, { signal })`, or Ctrl-C during `execute()`) interrupts the fiber, hands Layer finalizers the interruption Exit (including Layers acquired while the abort landed during a sibling's acquisition), and exits 130 like any other interruption.
