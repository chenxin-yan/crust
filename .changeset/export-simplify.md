---
"@crustjs/core": patch
---

Export the `Simplify` helper type from the package root. Consumers with `declaration: true` exporting inferred `defineFlag`/`defineArg`/builder values no longer hit TS2742/TS2883 ("cannot be named without a reference to a private chunk").
