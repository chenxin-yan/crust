---
"@crustjs/core": minor
"@crustjs/testing": minor
---

Make core `run()` quiet and captured by default. Every `RunOutcome` includes `stdout` and `stderr`; completed outcomes carry the typed action result, finished outcomes identify the Extension, and failed outcomes retain the original escaping error and partial output after cleanup. Invocation failures now resolve to `failed` instead of rejecting. Optional IO callbacks forward live output once while retaining capture. `execute()` remains the streaming terminal adapter with error presentation and exit codes.

Remove `captureRun` and `CapturedRun` from `@crustjs/testing`: call `app.run(path, input)` directly. Keep `captureExecute` for terminal semantics. `runInteractive` explicitly propagates failed core outcomes through `done` and `waitFor`, including primitive thrown values.
