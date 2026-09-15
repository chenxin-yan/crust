---
"@crustjs/core": patch
---

Fix typed `run()` paths through siblings registered by one variadic `.add(a, b)` call: each path now narrows to its own command's input and result instead of the union of every sibling's shape.
