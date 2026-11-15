---
"@crustjs/core": minor
---

Flags can take a structured value checked by a schema. `body: { type: "json", schema: z.object({ name: z.string() }) }` parses `--body '{"name":"ada"}'` (or its `env` value) as JSON and hands the schema the parsed value; `run()`, `--input`, and MCP pass the JSON value itself. `ctx.flags.body` is the schema's output, typed `run()` input takes the schema's input, and a schema issue is a `VALIDATION` error naming the flag. The schema's input JSON Schema becomes the flag's command input property, so the `schema` command and MCP `tools/list` show the shape and an agent sends an object. The schema's input must accept JSON data: `z.date()` or `z.bigint()` on a `json` flag is a TypeScript error (`FIX_SCHEMA_INPUT`). A `json` schema flag takes one value; `multiple` is not supported.
