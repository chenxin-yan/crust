---
"@crustjs/core": patch
---

Preparing a command tree no longer builds an intermediate snapshot when no registered Extension defines `sections`, making fresh invocations and `Crust.snapshot()` cheaper for apps without section callbacks. Section callbacks, help output and snapshots are unchanged.
