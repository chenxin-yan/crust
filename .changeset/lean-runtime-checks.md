---
"@crustjs/core": minor
"@crustjs/extensions": minor
---

Drop runtime checks that only inputs bypassing the types could reach. Runtime checks now cover only values TypeScript can't see, such as names typed `string`, spread arrays, and `Record` definitions. Breaking only for callers that bypass the types (`as never`, `any`, or plain JavaScript):

- `defineCommand()` without a recipe no longer throws a `DEFINITION` error (`missing-recipe`); the command fails with a `TypeError` when it is first built.
- A flag `env` that is not `{ name: string, delimiter?: string }` is no longer rejected (`invalid-env`), and a `delimiter` or `env.delimiter` is no longer rejected for lacking `multiple: true` (`delimiter-without-multiple`); an empty one still fails with `empty-delimiter`.
- A documentation section with both `only` and `except` uses `only` instead of throwing.
- `version()` and `updateNotifier()` no longer throw when neither the call nor the root metadata supplies a version.

`"missing-recipe"`, `"invalid-env"`, and `"delimiter-without-multiple"` are removed from `DefinitionErrorReason`.
