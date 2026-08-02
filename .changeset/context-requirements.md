---
"@crustjs/core": minor
---

Contexts declare requirements: `defineContext(name, requirements, setup)` accepts `{ flags?: [...named flag defs], ctx?: [...Context factories] }`, and setup receives `{ options, flags, ctx }` — the validated parsed flags of the resolved invocation narrowed to the declared flag defs, plus the values of the declared Context dependencies.

`.provide(...instances)` is variadic and provide order is free: Contexts on the resolved command path are constructed topologically by their declared `ctx` dependencies. A missing dependency or a dependency cycle throws `CrustError("DEFINITION", ...)`, also caught by command-tree validation. Flag requirements are checked at the `.provide()` call site — compile-time against the builder's inheritable flags and at runtime (declare `.flags()` before `.provide()`).

Every factory also exposes `.of(value)`, returning an instance whose setup yields the precomputed value with its requirements considered satisfied — for test doubles:

```ts
const env = defineFlag("env", { type: "string", inherit: true });

const config = defineContext("config", { flags: [env] }, ({ flags }) => loadConfig(flags.env));
const db = defineContext("db", { ctx: [config] }, ({ ctx }) => connect(ctx.config));

app.flags(env).provide(db(), config()); // constructed as config → db

// In tests:
app.provide(db.of(fakeDb), config.of(fakeConfig));
```

Disposal follows construction: values implementing `Symbol.dispose`/`Symbol.asyncDispose` are disposed in reverse construction order, on success or failure.
