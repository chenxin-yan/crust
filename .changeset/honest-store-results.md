---
"@crustjs/store": minor
---

Reject persisted core field values that still mismatch their declared type after coercion, and reject non-finite built-in numbers before persistence. Core field definitions now require a declared primitive `type`. `write()`, `update()`, and `patch()` now return the config they persisted, including schema transformations, and reject values that JSON serialization would alter (`NaN`, `Infinity`, `-0`, sparse arrays, `undefined` object properties). Hand-written `validate` transforms are now typed to return the field's declared type and are re-checked at runtime. The internal `PlatformEnv` type is no longer exported.
