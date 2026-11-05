---
"@crustjs/core": patch
---

Typed `run(path)` and `at(path)` now type paths below a command the types can't see into, such as an Extension command after `.extend()` of an Extension with a runtime-only command name, as `RunOutcome<unknown>` instead of `RunOutcome<never>`. Such paths were already accepted and run at runtime; known paths stay precise and unknown paths under a fully typed tree are still compile errors.
