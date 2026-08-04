---
"@crustjs/testing": minor
"@crustjs/core": minor
---

New `captureExecute(app, argv)` in `@crustjs/testing` drives the terminal `execute()` path in-process: exit-code protocol (`0`/`1`/`130`), Extension `onError` rendering, and cancellation are assertable without subprocess probes; `process.exitCode` is restored afterwards. To support it, `Crust.execute()` now accepts an optional `io` override alongside `argv`.
