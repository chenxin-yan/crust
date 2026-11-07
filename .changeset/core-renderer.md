---
"@crustjs/core": minor
---

An Extension can choose how an invocation's output is rendered with `.renderer(select)`. After every setup, Core calls and awaits `select(ctx)` once (it may be `async`, to load a formatter lazily); the returned `Renderer` receives the Command Action's and Contexts' `stdout()` lines (`text`) and `stderr()` lines (`diag`), the completed action's result (`result`), and, in `execute()`, a failure no `onError` hook claimed (`error`, in place of Core's `Error: …` lines). Return `undefined` to keep the default. Output written before the renderer is chosen waits for it. An Extension's own `ctx.stdout`/`ctx.stderr` bypass the renderer, exit codes are unchanged, and at most one Extension in an application may set `.renderer()` (a second is a `DEFINITION` error, `duplicate-renderer`).
