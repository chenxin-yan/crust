---
"@crustjs/core": patch
---

Reduce redundant child-map copying during command registration, accumulating variadic additions in one private map while preserving eager materialization and immutable builders.
