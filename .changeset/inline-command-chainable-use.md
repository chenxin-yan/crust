---
"@crustjs/core": minor
---

Add inline `Crust.command(name, recipe)` (root-only) for app-local leaf subcommands and a chainable `CommandDefinitionBuilder.use(factory)` for declaring Context demand.

**Breaking (pre-1.0):** the `uses` config field on `defineCommand` is removed. Declare command dependencies with chained `.use(factory)` calls inside the recipe instead:

```ts
// before
defineCommand("deploy", { uses: [logging, auth] }, (cmd) => cmd.action(...));
// after
defineCommand("deploy", (cmd) => cmd.use(logging).use(auth).action(...));
```

`.use(logger)` is demand (a factory); `.provide(logger())` is supply (an instance). Context and Extension `uses` config fields are unchanged. Inline `.command()` recipes are seeded with the call-site Contexts and Context-owned flags; unmet inline `.use()` demands fail typecheck with `FIX_MISSING_DEPENDENCY`.
