---
"@crustjs/core": minor
"@crustjs/testing": minor
---

Testing helpers now autocomplete argv. `captureRun()`, `captureExecute()`, and `runInteractive()` are generic over the app, and their `argv` parameter suggests the command names, aliases, and dashed flag spellings the application statically declares — including flags and subcommands defined inside `defineCommand` recipes — while continuing to accept arbitrary strings for positionals and flag values. The hint union is exported as `ArgvHints<App>`.

To support this, `@crustjs/core` threads a new trailing `Hints` type parameter through `Crust`, `CommandDefinitionBuilder`, and `CommandDefinition`: `defineCommand()` captures the recipe's statically known nested spellings, and `.add()` folds them into the parent. All new parameters are trailing and defaulted, so existing annotations keep working. Widened (non-literal) definitions and Extension-contributed commands or flags contribute no hints.
