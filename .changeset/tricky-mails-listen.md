---
"@crustjs/core": minor
"@crustjs/extensions": minor
"@crustjs/man": minor
---

Add `env` and `delimiter` to `FlagDef`. A flag with `env` reads the named environment variable when absent from argv (argv > `env` > `default`); the value goes through the same coercion, `choices`, `parse`, and schema path as an argv token and satisfies `required`. `delimiter` (repeatable flags only) splits argv and environment values into occurrences, dropping empty segments. `FlagSnapshot`/`DocumentationFlag` carry `env` and `delimiter` names; help and generated man pages render `[env: NAME]` after the description and never the value. `formatDescription` accepts an optional trailing `env` argument. Structured `run()` input does not read the environment and is never split.
