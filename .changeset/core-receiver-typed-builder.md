---
"@crustjs/core": minor
---

Speed up type-checking of `.add()` chains and command recipes. Type-check cost now grows linearly with the number of commands: a 100-command app costs about 280k type instantiations instead of 380k, a 200-command app 530k instead of 820k, and a 400-command app 1.0M instead of 2.0M (check time −22% / −24% / −30%). Compile-time error messages are unchanged. Two corner cases change:

- Explicit type arguments on `.flags()`, `.args()`, `.add()`, and `.command()`, such as `app.add<readonly [typeof deploy]>(deploy)`, are now a compile error (`FIX_EXPLICIT_TYPE_ARGUMENTS`). Remove them; these methods infer their type arguments from the builder they are called on. This also removes the explicit-tuple way to call `.add()` on a builder union (`condition ? app.add(a) : app`); write the chain in each branch instead. `.action()`, `.provide()`, `.use()`, and `.extend()` are unchanged.
- Reassigning a builder variable with commands whose names are not literal types, as in `for (const name of names) app = app.add(defineCommand(name, recipe))`, no longer compiles. Register the list in one call: `app.add(...names.map((name) => defineCommand(name, recipe)))`.
