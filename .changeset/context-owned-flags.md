---
"@crustjs/core": minor
---

Add Context-owned flags with `defineContext(name, { ownFlags }, setup)`. Calling `.provide()` installs each owned flag as an inheritable effective flag on that command and descendants mounted afterward, refines the builder's flag types, and passes the validated values to Context setup:

```ts
const apiKey = defineFlag("api-key", { type: "string" });
const api = defineContext("api", { ownFlags: [apiKey] }, ({ flags }) =>
  createClient({ apiKey: flags["api-key"] }),
);

const app = new Crust("cli").provide(api()).mount(deploy);
```

Owned flag names, short forms, and aliases cannot collide with application, other Context, or Extension flags; collisions throw `CrustError("DEFINITION", ...)` in either fluent registration order. Extension flag collisions now use `details.reason: "flag-collision"` instead of `"extension-flag-collision"`, with updated message wording.

`.of(value)` test doubles retain owned flags so test and production command grammars match. Existing `inherit: true` flags and `{ flags: [...] }` requirements are unchanged, and `.provide()` does not backfill descendants mounted on an earlier builder.

`ContextInstance` and `ContextFactory` gain an owned-flags generic, while `Crust` and `CommandDefinitionBuilder` gain an `Owned` generic. Pre-1.0 consumers that specify these generic parameters positionally must update their type arguments.
