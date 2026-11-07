---
"@crustjs/core": minor
---

Extension hooks can find where a command definition is mounted: `ctx.commandPathOf(definition)` returns the canonical names from the application root through the command added from that definition, like `ctx.commandPath`, or `undefined` when the application does not mount it. Definitions match by identity (a `.as()` copy is a different definition); one added more than once resolves to its shallowest path.
