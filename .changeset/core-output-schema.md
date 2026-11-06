---
"@crustjs/core": minor
"@crustjs/utils": minor
---

Commands can declare their result with `.output(schema)` (any Standard Schema). Declared before `.action()`, TypeScript requires the action to return the schema's input type; at runtime Crust validates the awaited result and returns the schema's output as the `result`, typed in `run()` and passed to `postRun`. A rejected result fails with the new `OUTPUT` `CrustError` code (`details.issues`, paths relative to the result). `CommandSnapshot.outputSchema` carries the result's draft 2020-12 JSON Schema when the schema implements Standard JSON Schema, and `@crustjs/core/tooling` exports `standardJsonSchema(schema, "input" | "output")`, which returns that JSON Schema or `undefined` when the schema has no converter or it throws. Commands without `.output()` are unchanged. `@crustjs/utils/schema` exports the `StandardJSONSchema` and `InferInput` types.
