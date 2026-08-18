---
"@crustjs/core": minor
---

Replace command- and Context-level `requires` plus eager Context value bags with lazy, typed `await ctx.use(factory)` resolution in actions and Context setup. Dependency, missing-provider, and cycle handling now happen at pull time; pull setup dependencies before acquiring resources. `ContextRequirements` is removed, and `ContextSetup`, `ContextInstance`, and `ContextFactory` have fewer generic parameters. Extension hooks can consume Contexts, Extensions can install root Contexts with `provides`, and typed `run()` shapes include inherited Context-owned flags.
