---
"@crustjs/core": patch
---

Faster type-checking for fluent builder chains: long `.flags()` chains hit `TS2589` about 3x later, the `.provide()` chain ceiling is removed, and `ctx` inference no longer silently degrades on long `.provide()` chains.
