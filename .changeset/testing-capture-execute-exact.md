---
"@crustjs/testing": patch
---

`captureExecute(app, argv)` now accepts every app under `exactOptionalPropertyTypes`. It takes core's `ExecuteOptions` instead of a copy of its members, and its own `env` and `raw` options accept an explicit `undefined`.
