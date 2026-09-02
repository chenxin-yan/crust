---
"@crustjs/core": minor
---

`.use()` is now variadic, matching `.flags()`, `.provide()`, and `.add()`: `.use(logging, auth)` declares multiple Context demands in one call. Single-factory calls are unchanged.
