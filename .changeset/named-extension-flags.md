---
"@crustjs/core": minor
"@crustjs/extensions": patch
"@crustjs/skills": patch
---

Change `defineExtension()` flag authoring to a readonly array of named definitions, matching `.flags()` and `defineContext()`. Replace extension flag records such as `{ verbose: { type: "boolean" } }` with `[{ name: "verbose", type: "boolean" }]`; use an inline definition to set the Extension-only `recursive` option.
