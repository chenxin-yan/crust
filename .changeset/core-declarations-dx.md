---
"@crustjs/core": patch
---

Fix `TS2344` in `@crustjs/core`'s shipped declarations for projects that enable `exactOptionalPropertyTypes` without `skipLibCheck`. `execute({ argv })` now accepts a `readonly string[]`, such as an `as const` fixture. `parseFlagValues()` from `@crustjs/core/tooling` now keeps inline `choices` as literal unions instead of widening them to `string`. `AnyContextInstance` is now exported, so the open provider form `ExtensionFactory<[], {}, readonly AnyContextInstance[]>` can be written. Code that mutated `ExecuteOptions.argv` through the interface must now copy it first.
