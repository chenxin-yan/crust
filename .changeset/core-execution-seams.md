---
"@crustjs/core": minor
"@crustjs/testing": patch
---

Return the terminal exit code from `Crust.execute()`, reject dynamic flag spelling collisions instead of overwriting them, and validate command-authored documentation sections eagerly. Remove `snapshotCommand(node)` from `@crustjs/core/tooling`; use `app.snapshot()` instead. `captureExecute()` now reads the returned exit code without serializing calls or restoring `process.exitCode`.
