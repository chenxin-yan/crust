---
"@crustjs/store": patch
---

Materialize schema defaults before `update()` callbacks and `patch()` merges so mutation inputs match their inferred store types, without revalidating transformed defaults during `read()`.
