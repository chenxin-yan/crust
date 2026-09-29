---
"@crustjs/core": minor
---

Rename `ctx.finish()` to `ctx.handled()` in Extension `preRun` hooks. The returned token type `Finished` is now `Handled`, and the matching `RunOutcome` and `postRun` status `"finished"` is now `"handled"`. Update hooks to `return ctx.handled()` and outcome checks to `outcome.status === "handled"`.
