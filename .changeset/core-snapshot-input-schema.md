---
"@crustjs/core": minor
---

Schema-backed args and flags now carry their Standard Schema's draft 2020-12 input JSON Schema in the Command Snapshot as `inputSchema` (when the schema can produce one), and `commandInputSchema()` from `@crustjs/core/tooling` advertises it for that definition when `run()` accepts what it describes: top-level `type` `"string"` (`"boolean"` for `type: "boolean"` flags), or `"array"` of those for variadic and `multiple`, without `$ref`/`$defs`. Other schema-backed definitions, such as `z.coerce.number()`, keep their token type. Output for non-schema definitions is unchanged. `CommandInputPropertySchema` widens `format` to `string` and `enum` to strings and booleans to match the keywords such schemas carry.
