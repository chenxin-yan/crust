---
"@crustjs/openapi": minor
---

A `defineApi()` handle whose build failed returns its message from `onError` as the function that prints it, so other Extensions' `onError` hooks still see the failure first.
