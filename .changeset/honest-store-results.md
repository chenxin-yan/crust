---
"@crustjs/store": minor
---

Reject persisted core field values that still mismatch their declared type after coercion. Core field definitions now require a declared primitive `type`. `write()`, `update()`, and `patch()` now return the config they persisted, including schema transformations. The internal `PlatformEnv` type is no longer exported.
