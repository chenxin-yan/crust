---
"@crustjs/core": patch
---

Fix `TS2589: Type instantiation is excessively deep and possibly infinite` after about 90 chained `.flags()` calls on a command, or about 100 chained `.provide()` calls with Contexts that own flags. `defineExtension(…).flags()` and `defineContext(…).flags()` chains no longer hit the same limit.
