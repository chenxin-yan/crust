---
"@crustjs/extensions": patch
---

`version()` without a value now throws a `DEFINITION` error on `--version` when the root has no `version` metadata, instead of printing `undefined`. TypeScript already rejects this setup; the runtime check covers builds that skip type-checking.
