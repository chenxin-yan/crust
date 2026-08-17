---
"@crustjs/core": minor
---

Replace command-level `requires` and eager Context value bags with lazy, typed `await ctx.use(factory)` resolution. Extension hooks can consume Contexts, and Extensions can install root Contexts with `provides`. Typed `run()` shapes for added definitions include the Context-owned flags inherited from the parent path.
