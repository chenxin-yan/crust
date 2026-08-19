---
"@crustjs/core": major
---

Replace `ctx.use(factory)` with declared, type-checked lazy Context bags.

- Contexts, command definitions, and Extensions declare dependencies with `uses`.
- Consumers access memoized values with `await ctx.<name>`.
- `.provide()`, `.add()`, and `.extend()` reject unsatisfied dependency graphs at the composition site.
- Extension `provides` now contribute to the application's accumulated Context type.
- Remove the public `ContextResolver` type and `ctx.use()` API.
