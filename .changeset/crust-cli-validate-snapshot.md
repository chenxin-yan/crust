---
"@crustjs/crust": patch
---

`crust build` now rejects a Command Snapshot without a root command name with the "invalid Command Snapshot" guidance instead of a `TypeError`.
