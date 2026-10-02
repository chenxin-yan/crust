---
"@crustjs/core": patch
---

`defineCommand(name, config)` called from JavaScript without a recipe now throws a `DEFINITION` error (`reason: "missing-recipe"`) instead of a later `TypeError` from `.add()`.
