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

Make requirements capability-only. `defineCommand(name, { requires: [logging, auth] }, recipe)` and `defineContext(name, { flags, requires: [config] }, setup)` accept a plain array of Context factories. Top-level `flags` means definitions the unit owns or parses; `requires` means Context capabilities supplied by the command path. The previous flat fields and the intermediate `requires: { flags, ctx }` shape are removed. Required raw flags are not injected into downstream handler types; expose any needed value from its owning Context.

Owned flag names, short forms, and aliases cannot collide with application, other Context, or Extension flags; collisions throw `CrustError("DEFINITION", ...)` in either fluent registration order. Extension flag collisions now use `details.reason: "flag-collision"` instead of `"extension-flag-collision"`, with updated message wording.

`.of(value)` test doubles retain owned flags so test and production command grammars match. `.provide()` does not backfill descendants mounted on an earlier builder.

The generic slots on `ContextInstance`, `ContextFactory`, `ContextSetup`, `Crust`, and `CommandDefinitionBuilder` now carry Context-owned flags instead of required or inherited flags. Pre-1.0 consumers that specify these generic parameters positionally must update their type arguments.
