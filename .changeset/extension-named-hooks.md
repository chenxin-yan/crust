---
"@crustjs/core": minor
"@crustjs/extensions": minor
"@crustjs/skills": minor
---

Replace Extension `intercept(ctx, next)` and `handleError(error, ctx, next)` with named `hooks`: `preRun(ctx)`, `postRun(ctx, outcome)`, and `onError(error, ctx)`. `preRun` returns `ctx.finish()` to short-circuit successfully; `postRun` runs in reverse extension order after every settled invocation; `onError` returns `true` after rendering an `execute()` failure.

Command Handlers now receive `rootCommand`, including handlers for Extension-owned commands. Migrate Extension-owned routing work into real `.handle()` callbacks.
