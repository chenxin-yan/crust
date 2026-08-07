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

Make requirements capability-only. `defineCommand(name, { requires: [logging, auth] }, recipe)` and `defineContext(name, { flags, requires: [config] }, setup)` accept a plain array of Context factories. Top-level `flags` means definitions the unit owns or parses; `requires` means Context capabilities supplied by the command path. Required raw flags are not injected into downstream handler types; expose any needed value from its owning Context.

Context setup now receives the invocation's injected `stdout` and `stderr` callbacks, shared with the Command Handler. Contexts can encapsulate output behavior instead of exposing flag state for every handler to interpret:

```ts
const logging = defineContext("logging", { flags: [verbose] }, ({ flags, stderr }) => ({
  debug: (message: string) => flags.verbose && stderr(message),
}));
```

Owned flag names, short forms, and aliases cannot collide with application, other Context, or Extension flags; collisions throw `CrustError("DEFINITION", ...)` in either fluent registration order. Extension flag collisions now use `details.reason: "flag-collision"` instead of `"extension-flag-collision"`, with updated message wording.

`.of(value)` test doubles retain owned flags so test and production command grammars match. `.provide()` does not backfill descendants mounted on an earlier builder.

The generic slots on `ContextInstance`, `ContextFactory`, `ContextSetup`, `Crust`, and `CommandDefinitionBuilder` now carry Context-owned flags instead of required or inherited flags. Pre-1.0 consumers that specify these generic parameters positionally must update their type arguments.
