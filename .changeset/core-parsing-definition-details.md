---
"@crustjs/core": patch
---

Dynamic flag and argument definitions with a default outside `choices`, or a multi-character `short`, now throw `DEFINITION` errors that name the definition and carry `details` (`reason: "default-outside-choices"` or `"invalid-short"`).
