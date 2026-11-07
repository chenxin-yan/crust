---
"@crustjs/core": minor
---

A command's `.use()` now also takes an Extension or Extension factory, standing for the Contexts that Extension provides: `.use(time)` gives the action `ctx.clock` when `time()` provides `clock`, without importing the Context factory. TypeScript checks those Contexts where the command is added, as for `.use(clock)`; at runtime, preparing an app that does not extend the Extension throws a `DEFINITION` error with the new reason `missing-extension`.
