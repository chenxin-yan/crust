---
"@crustjs/core": patch
---

Speed up type-checking of one `.add(a, b, …)` call with many command definitions: the extra cost of first using the returned app now grows linearly with the number of definitions instead of quadratically. Compile-time error messages are unchanged.
