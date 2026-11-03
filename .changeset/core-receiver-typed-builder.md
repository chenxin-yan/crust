---
"@crustjs/core": minor
---

Speed up type-checking of `.add()` chains and command recipes: type-check cost now grows linearly with the number of commands. Compile-time error messages are unchanged. Three corner cases change:

- Explicit type arguments on `.flags()`, `.args()`, `.add()`, and `.command()`, such as `app.add<readonly [typeof deploy]>(deploy)`, are now a compile error (`FIX_EXPLICIT_TYPE_ARGUMENTS`). Remove them; these methods infer their type arguments from the builder they are called on. This also removes the explicit-tuple way to call `.add()` on a builder union (`condition ? app.add(a) : app`); write the chain in each branch instead. `.action()`, `.provide()`, `.use()`, and `.extend()` are unchanged.
- `.add()` and `.command()` on a builder union whose branches differ, such as `(useTelemetry ? app.extend(telemetry) : app).add(child)`, are now a compile error, like the other builder methods already were. Keep the command shape static or write the chain in each branch (see [Conditional chains](https://crustjs.com/docs/api/crust#conditional-chains)).
- Reassigning a builder variable with commands whose names are not literal types, as in `for (const name of names) app = app.add(defineCommand(name, recipe))`, no longer compiles. Register the list in one call: `app.add(...names.map((name) => defineCommand(name, recipe)))`.
