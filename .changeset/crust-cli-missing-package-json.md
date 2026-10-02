---
"@crustjs/crust": patch
---

`crust build` now reports a missing or non-object `package.json` directly instead of failing later with an unrelated artifact or `name` error.
