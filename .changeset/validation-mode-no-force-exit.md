---
"@crustjs/core": patch
"@crustjs/crust": patch
---

Make build-validation mode safe for in-process callers.

`Crust.execute()` no longer calls `process.exit()` when only
`CRUST_INTERNAL_VALIDATE_ONLY=1` is set — it now runs the validation
pipeline, surfaces errors via stderr and `process.exitCode`, and returns
like the rest of `.execute()`'s error paths. Process termination is
opt-in via the new `CRUST_INTERNAL_VALIDATE_FORCE_EXIT=1` env var, which
`crust build`'s `validateEntrypoint()` sets on its spawned subprocess.

For end users there is no change: `crust build` now sets both env vars on
its validation subprocess, preserving the existing behavior of skipping
entrypoint code after `await app.execute()` during the build check.
Tests and embedders that need to exercise the validation pipeline can
now do so without being terminated.
