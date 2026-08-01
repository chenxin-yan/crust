---
"@crustjs/core": minor
---

Rename `context()` to `defineContext()` and `extension()` to `defineExtension()`.

Add `defineFlag()` and `defineFlags()` const-generic identity helpers for validating and preserving separately declared flag definitions without `as const`.

This is a breaking rename with no compatibility aliases. Update imports and call sites to the new names.
