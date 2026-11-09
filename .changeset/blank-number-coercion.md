---
"@crustjs/utils": minor
"@crustjs/store": minor
"@crustjs/env": patch
---

`tryCoerceNumber` returns `undefined` for empty or whitespace-only input instead of `0`. Store `type: "number"` fields reject a persisted blank string with a `VALIDATION` error instead of reading it as `0`, and `@crustjs/env` reports `PORT=""` as invalid for `type: "number"`, as documented.
