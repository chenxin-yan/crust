---
"@crustjs/core": minor
---

Make variadic builder methods accumulative with loud duplicate errors:

- `.flags()` and `.args()` now accumulate across chained calls instead of silently replacing earlier definitions, preserving their combined runtime and inferred types. Duplicate names, short forms, or aliases throw a `DEFINITION` error at the call that introduces the collision.
- `.handle()` is set-once: calling it a second time on the same builder throws instead of replacing the handler.
- `.extend()` rejects duplicate Extension names, both within one call and across calls.
