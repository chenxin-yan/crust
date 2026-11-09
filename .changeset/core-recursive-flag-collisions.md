---
"@crustjs/core": minor
---

Compile-time collision checks between Extension flags and the flags of commands below the root now follow the runtime: only recursive Extension flags (the default) and flags owned by Contexts an Extension provides reach those commands.

No longer compile errors, since the app runs:

- a nested child added inside an inline `.command()` recipe after `.extend()` of an Extension with recursive flags (`Flag spelling "trace" collides with a registered Extension flag`)
- a child, inline `.command()`, or Extension command declaring a spelling of an Extension flag with `recursive: false`, which is registered only on the root

Now compile errors, where the runtime already throws `DEFINITION`: after an Extension with runtime-only recursive flags, an inline `.command()` or Extension command declaring a flag that collides with an inherited Context flag or a statically known recursive Extension flag.
