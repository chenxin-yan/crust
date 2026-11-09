---
"@crustjs/core": minor
---

Commands now build on first use. `.add()` records each definition by name and metadata, and an invocation runs only the recipes on the path it routes through, so startup no longer grows with the number of commands and long `.add()` chains are linear. `ctx.rootCommand` and `ctx.command` are projected on demand.

**Behavior change:** an error thrown by a command's recipe, or a recipe-time collision with an inherited flag or a missing Context demand, now surfaces when that command is run or the tree is inspected (`app.snapshot()`, help, `crust build`) instead of at `.add()`. Other commands keep working. Call `await app.snapshot()` in a test to validate every command eagerly.
