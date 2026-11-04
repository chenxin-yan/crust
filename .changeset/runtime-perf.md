---
"@crustjs/core": patch
---

Speed up dispatch, help, and command registration. `run()` and `execute()` reuse one root Command Snapshot per prepared app instead of rebuilding it each time, so `command`/`rootCommand` keep the same identity across invocations; apps with `URL` or mutable JSON-array defaults still get a fresh snapshot each time, so later changes to a default stay visible. Snapshot objects keep fast property access, and `.add(...definitions)` checks name collisions in linear time; snapshot contents and collision errors are unchanged.
