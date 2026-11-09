---
"@crustjs/core": minor
---

`.flags()` on commands, Contexts, and Extensions accepts one record keyed by flag name: `.flags({ out: { type: "string", short: "o" }, "dry-run": { type: "boolean" } })`. A compile error lands on the offending flag's own object literal. `defineFlag(def)` defines a reusable flag without a name; the key it is attached under names it, so `.flags({ format })` and `.flags({ output: format })` share one definition.

- A flag whose name is integer-like, such as `"2"` or `"10"`, now throws a `DEFINITION` error (`reason: "integer-like-name"`), because JavaScript lists such keys first and would reorder help and snapshots. A literal key is also a compile error, as is an unquoted number key such as `1.5` (write `"1.5"`). `.flags()` input that is not a plain-object record of object definitions throws a `DEFINITION` error (`reason: "invalid-flags"`), including a record written with a literal `__proto__` key, which sets the record's prototype instead of naming a flag.
- The Extension flag type argument is now a record: the fourth type argument of `Extension` and `ExtensionFactory` is an `ExtensionFlagsDef` (default `{}`) instead of a tuple of named definitions, and `InferExtensionFlags` takes that record. Annotations such as `ExtensionFactory<[], {}, [], [], Commands>` become `ExtensionFactory<[], {}, [], {}, Commands>`. The third type argument of `ContextBuilder` is likewise the owned flag record.
