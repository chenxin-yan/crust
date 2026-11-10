---
"@crustjs/core": patch
"@crustjs/prompts": patch
"@crustjs/extensions": patch
---

`schema <cmd> --json` and the MCP `schema` tool work again for commands whose `.output()` is a Zod schema. Command Snapshots now carry a plain JSON copy of each JSON Schema, so `outputSchema` no longer keeps the non-enumerable `~standard` key that Zod attaches and the JSON output check rejected.

TypeScript now catches a definition that compiles but fails on every run: a schema whose input type cannot accept the value the parser hands it, such as `{ type: "string", schema: z.number() }`, is a compile error (`FIX_SCHEMA_INPUT`); write `z.coerce.number()` or a pipeline that starts from a string. A narrower input such as `z.enum([...])` still compiles. A helper that is generic over the schema itself, such as `<S extends StandardSchemaV1>(schema: S) => defineFlag({ type: "string", schema })`, no longer compiles, because the input type is not known there: type its parameter as `StandardSchemaV1<string | undefined, Out>` (from `@standard-schema/spec`), or as `StandardSchemaV1<unknown, Out>` to also take schemas whose input is `unknown`, such as a stored `z.coerce.number()`.

Typed `run()` and `handle.run()` now type `onEvent`'s event like the outcome's `events`. Under `exactOptionalPropertyTypes`, optional fields that are often filled from optional flags accept an explicit `undefined`: prompt options such as `initial`, `default`, `placeholder`, and `theme`; typed `run()` arguments, flags, and `raw`; and `nextSteps` steps.
