---
"@crustjs/core": minor
"@crustjs/testing": minor
---

Infer action return values from typed `run()` calls and expose them from `captureRun()`. `CapturedRun` is now a discriminated success/error union: the success branch always owns `result` (typed from the selected action), the failure branch owns `error` instead, and `"error" in captured` narrows between them.
