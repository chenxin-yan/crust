---
"@crustjs/core": minor
---

Extension `postRun` hooks now receive the Command Action's result. A `completed` `InvocationOutcome` carries the action's awaited return value as `result` (`undefined` for a command without an action), in both `run()` and `execute()`. `execute()` still resolves to an exit code, and `run()` is unchanged.
