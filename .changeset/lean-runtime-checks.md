---
"@crustjs/core": minor
"@crustjs/extensions": minor
---

Drop runtime checks that only inputs bypassing the types could reach. Runtime checks now cover only values TypeScript can't see, such as names typed `string`, spread arrays, and `Record` definitions. Breaking only for callers that bypass the types (`as never`, `any`, or plain JavaScript):

- `defineCommand()` without a recipe no longer throws a `DEFINITION` error (`missing-recipe`); the command fails with a `TypeError` when it is first built.
- `version()` and `updateNotifier()` no longer throw when neither the call nor the root metadata supplies a version.

`"missing-recipe"` is removed from `DefinitionErrorReason`.

Runtime checks still reject a documentation section with both `only` and `except`, a flag `env` that is not `{ name: string, delimiter?: string }` (`invalid-env`), and a `delimiter` or `env.delimiter` on a flag without `multiple: true` (`delimiter-without-multiple`). Structural views can hide these properties from TypeScript without removing them at runtime.
