---
"@crustjs/core": minor
"@crustjs/extensions": patch
"@crustjs/skills": patch
---

Change `defineExtension()` flag authoring to a readonly array of named definitions, matching `.flags()` and `defineContext()`. Replace extension flag records such as `{ verbose: { type: "boolean" } }` with `[{ name: "verbose", type: "boolean" }]`; an inline definition is the documented way to set the Extension-only `recursive` option. Intra-extension flag spelling collisions now surface when `defineExtension()` is called instead of during application preparation. The exported `InferExtensionFlags`, `ExtensionContext`, `ExtensionHooks`, and `ExtensionConfig` generics now take the readonly named-definition array instead of a record.
