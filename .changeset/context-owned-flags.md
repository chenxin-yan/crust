---
"@crustjs/core": minor
---

Add Context-owned flags with `defineContext(name, { flags }, setup)`. Calling `.provide()` installs each owned flag as a propagating effective flag on that command and descendants mounted afterward, refines the builder's flag types, and passes the validated values to Context setup:

```ts
const apiKey = defineFlag("api-key", { type: "string" });
const api = defineContext("api", { flags: [apiKey] }, ({ flags }) =>
  createClient({ apiKey: flags["api-key"] }),
);

const app = new Crust("cli").provide(api()).mount(deploy);
```

Reshape dependencies on both definition APIs under a shared `requires` field. `defineCommand(name, { requires: { flags, ctx } }, recipe)` and `defineContext(name, { flags, requires: { flags, ctx } }, setup)` group declarations by relationship direction: top-level `flags` means flags the definition owns or parses, while `requires` means typed dependencies supplied by the command path. The previous flat `defineCommand` `{ flags, ctx }` fields and `defineContext` `{ ownFlags, flags, ctx }` fields are removed.

Owned flag names, short forms, and aliases cannot collide with application, other Context, or Extension flags; collisions throw `CrustError("DEFINITION", ...)` in either fluent registration order. Extension flag collisions now use `details.reason: "flag-collision"` instead of `"extension-flag-collision"`, with updated message wording.

`.of(value)` test doubles retain owned flags so test and production command grammars match. `.provide()` does not backfill descendants mounted on an earlier builder.

`ContextInstance` and `ContextFactory` gain an owned-flags generic, while `Crust` and `CommandDefinitionBuilder` gain an `Owned` generic. Pre-1.0 consumers that specify these generic parameters positionally must update their type arguments.
