---
"@crustjs/style": patch
---

Importing `@crustjs/style` is cheaper: chain methods and `fg`/`bg` now live on one shared prototype instead of being defined on every chain function. Chaining and `AnsiPair` behavior are unchanged; `open`/`close` remain own properties of each chain.
