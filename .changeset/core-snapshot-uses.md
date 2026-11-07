---
"@crustjs/core": minor
---

Command Snapshots gain `uses`: the names of the Contexts a command declares with its own `.use()`, in declaration order (`[]` when none). A parent's `.use()` and `.provide()` do not add to it. Extensions can read it from `ctx.command` to check whether the routed command opted in to a Context.
