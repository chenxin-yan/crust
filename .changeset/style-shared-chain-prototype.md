---
"@crustjs/style": patch
---

Importing `@crustjs/style` is cheaper: chain methods, `fg`/`bg`, and `open`/`close` now live on one shared prototype instead of being defined on every chain function. Chaining and `AnsiPair` behavior are unchanged.
