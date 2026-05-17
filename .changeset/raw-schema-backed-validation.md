---
"@crustjs/core": patch
"@crustjs/validate": patch
"@crustjs/store": patch
"@crustjs/utils": patch
---

Remove vendor-specific schema introspection and switch validated helpers to raw schema-backed parsing. `arg()`, `flag()`, and `field()` no longer infer type, requiredness, descriptions, multiplicity, or defaults from Zod/Effect internals. Missing values are passed to Standard Schema validation as `undefined`, so schema `.optional()` and `.default()` behavior applies naturally at runtime.

Validated CLI flags can now omit `{ type: "boolean" }`: raw flags parse `--flag` as `true`, `--no-flag` as `false`, and `--flag=value` as the string value. In raw mode, `--flag value` does not consume `value`; pass an explicit `type` parser hint to preserve legacy `--flag value` behavior.

Descriptions must now be supplied through Crust options. The internal `@crustjs/utils/schema` introspection exports (`inferOptions`, `extractDefault`, and related types) were removed.
