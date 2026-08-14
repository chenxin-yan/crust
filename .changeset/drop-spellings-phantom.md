---
"@crustjs/core": patch
---

Remove the internal `_types.spellings` phantom method from `Crust`. The `Sp` generic and compile-time flag-collision checks are unchanged; only the `@internal` phantom entry (previously kept for a type-level test) is gone from emitted declarations.
