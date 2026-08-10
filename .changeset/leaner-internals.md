---
"@crustjs/core": minor
"@crustjs/progress": minor
"@crustjs/store": minor
"@crustjs/extensions": patch
"@crustjs/skills": patch
"@crustjs/prompts": patch
"@crustjs/crust": patch
---

Remove the unused Context dependency accumulator generic from `Crust` and `CommandDefinitionBuilder`.

Remove `createProgress` and the exported `SpinnerController`, `CreateProgressOptions`, and `ProgressInstance` types from `@crustjs/progress`. Pass theme overrides directly to `spinner` or `progress`; spinner task callbacks still receive `updateMessage`.

Replace `CrustStoreError.withCause()` with the constructor's optional final `cause` argument, make `DEFINITION` error details optional, and remove the `DefinitionErrorDetails` type export from `@crustjs/store`.

Simplify completion models, prompt list rendering, skill installation helpers, and build internals without changing their runtime behavior.
