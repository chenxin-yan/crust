---
"@crustjs/utils": patch
"@crustjs/core": patch
"@crustjs/store": patch
"@crustjs/env": minor
"@crustjs/effect": patch
---

A Standard Schema without the optional `types` member now infers its output from the successful `validate()` result (awaited) instead of `unknown` in store fields, env variables, and schema-backed flags and arguments; declared `types.output` still wins. `defineEnv()` now rejects a literal default outside literal `choices` and an async `parse` at compile time, as `defineFlag()` does. A store schema whose output is not JSON data now fails with a `FIX_JSON_OUTPUT` message instead of "not assignable to type 'never'". `@crustjs/effect` exports the `HandlerInput` type that `service()` requires, and `@crustjs/core/tooling` exports `LocalValueBrand`.
