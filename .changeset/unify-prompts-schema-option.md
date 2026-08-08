---
"@crustjs/prompts": minor
---

Standardize Standard Schema usage on the dedicated `schema` option for `input()` and `password()`.

This is a breaking API change. Migrate `input({ validate: schema })` to `input({ schema })` (and likewise for `password`). The `validate` option is function-only again, and cannot be combined with `schema`.
