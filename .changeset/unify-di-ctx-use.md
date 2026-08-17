---
"@crustjs/core": minor
---

Replace command-level `requires` and eager Context value bags with lazy, typed `await ctx.use(factory)` resolution. Extension hooks can consume Contexts, and Extensions can install root Contexts with `provides`.
