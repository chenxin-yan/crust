---
"@crustjs/core": minor
"@crustjs/extensions": minor
"@crustjs/man": minor
---

Add `env: { name, delimiter? }` and `delimiter` to `FlagDef`. A flag with `env` reads the named environment variable when absent from argv (argv > env > `default`); the value goes through the same coercion, `choices`, `parse`, and schema path as an argv token and satisfies `required`. Flag-level `delimiter` splits string argv occurrences; `env.delimiter` independently splits environment text. Both require repeatable flags and drop empty segments, with no implicit separator inheritance. `FlagSnapshot`/`DocumentationFlag` carry the immutable environment binding and argv delimiter; help and generated man pages render `[env: NAME]` after the description and never the value. `formatDescription` accepts an optional trailing `env` argument. Structured `run()` input does not read the environment and is never split.
