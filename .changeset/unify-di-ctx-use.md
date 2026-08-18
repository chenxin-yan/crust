---
"@crustjs/core": minor
---

Unify Context dependencies on lazy, typed `await ctx.use(factory)` resolution in actions, Extension hooks, and Context setup.

- **Context setup pulls its own dependencies**: setup receives the same pull-based `ctx` resolver as actions; `defineContext`'s `requires` option and eager Context value bags are removed. Pull setup dependencies before acquiring resources.
- **Dependency handling moves to pull time**: missing providers, dependency cycles, and flag-phase violations reject at the `ctx.use()` call site instead of `.provide()` time.
- **`ContextRequirements` is removed**; `ContextSetup`, `ContextInstance`, and `ContextFactory` have fewer generic parameters.
- **Extensions**: hooks can consume Contexts, Extensions can install root Contexts with `provides`, and typed `run()` shapes include inherited Context-owned flags.
