---
"@crustjs/core": minor
---

Reject unknown argument, flag, and top-level keys in `app.run()` and `handle.run()` inputs held in variables, not only in object literals. Keys set to `undefined` are still accepted.
