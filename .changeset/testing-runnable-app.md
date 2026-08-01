---
"@crustjs/testing": patch
---

Accept any `run()`-capable builder in `captureRun` and `interactiveRun`, so `.sub()` child builders (`ChildCrust`) can be tested directly without a cast. The parameter is the new structural `RunnableApp` interface.
