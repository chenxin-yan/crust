---
"@crustjs/core": minor
---

Speed up type-checking of `.add()` chains and command recipes. Type-check cost now grows linearly with the number of commands: a 100-command app costs about 270k type instantiations instead of 370k, a 200-command app 510k instead of 810k, and a 400-command app 1.0M instead of 2.0M (check time −23% / −26% / −31%). Compile-time error messages are unchanged. Three corner cases change:

- Explicit type arguments on `.flags()`, `.args()`, `.action()`, `.add()`, and `.command()`, such as `.action<void>(…)` or `app.add<readonly [typeof deploy]>(deploy)`, are now a compile error (`FIX_EXPLICIT_TYPE_ARGUMENTS`). Remove them; these methods infer their type arguments from the builder they are called on. `.provide()`, `.use()`, and `.extend()` are unchanged.
- Reassigning a builder variable with commands whose names are not literal types, as in `for (const name of names) app = app.add(defineCommand(name, recipe))`, no longer compiles. Register the list in one call: `app.add(...names.map((name) => defineCommand(name, recipe)))`.
- `.add()` and `.command()` on a builder union (`condition ? app.add(a) : app`) now compile. The result types only the command paths every branch has, plus the ones the call adds.
