---
"@crustjs/crust": minor
---

`crust build` now runs build hooks from every registered Extension in registration order. Extension presence is the source of intent; the Extension-specific `--man` flag is removed, and `--no-validate` is the single opt-out that skips entry preparation and all build hooks. npm package staging includes every top-level artifact directory emitted by hooks; the name `bin` is reserved for the generated npm executables.
