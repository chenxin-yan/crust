---
"@crustjs/core": patch
---

Add the `defineExtension(id, factory)` form, which returns an `ExtensionFactory` with `.id`, and export the new `ExtensionFactory` type. Official extensions in `@crustjs/extensions`, `@crustjs/skills`, and `@crustjs/man` are migrated; their exported shapes are unchanged.
