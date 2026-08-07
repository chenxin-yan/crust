---
"@crustjs/core": minor
---

Contexts declare capability requirements: `defineContext(name, config, setup)` accepts `{ flags?: [...owned flag defs], requires?: [...Context factories] }`, and setup receives `{ options, flags, ctx }` — validated values for that Context's owned flags only, plus the values of its declared Context dependencies.

`.provide(...instances)` is variadic and provide order is free: Contexts on the resolved command path are constructed topologically by their declared `requires` dependencies. A missing dependency or a dependency cycle throws `CrustError("DEFINITION", ...)`, also caught by command-tree validation.

Every factory also exposes `.of(value)`, returning an instance whose setup yields the precomputed value with its requirements considered satisfied — for test doubles:

```ts
const env = defineFlag("env", { type: "string" });

const config = defineContext("config", { flags: [env] }, ({ flags }) => loadConfig(flags.env));
const db = defineContext("db", { requires: [config] }, ({ ctx }) => connect(ctx.config));

app.provide(db(), config()); // constructed as config → db

// In tests:
app.provide(db.of(fakeDb), config.of(fakeConfig));
```

Disposal follows construction: values implementing `Symbol.dispose`/`Symbol.asyncDispose` are disposed in reverse construction order, on success or failure.
