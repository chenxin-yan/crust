---
"@crustjs/core": patch
"@crustjs/prompts": patch
"@crustjs/extensions": patch
---

`schema <cmd> --json` and the MCP `schema` tool work again for commands whose `.output()` is a Zod schema. Command Snapshots now carry a plain JSON copy of each JSON Schema, so `outputSchema` no longer keeps the non-enumerable `~standard` key that Zod attaches and the JSON output check rejected.

TypeScript now catches more definitions that compile but fail on every run:

- A schema whose input type cannot accept the value the parser hands it, such as `{ type: "string", schema: z.number() }`, is a compile error (`FIX_SCHEMA_INPUT`); write `z.coerce.number()` or a pipeline that starts from a string. A narrower input such as `z.enum([...])` still compiles.
- Two Extensions that set a `.renderer()` in one `.extend()` call, such as `json()` and a custom renderer, are a compile error (`FIX_DUPLICATE_RENDERER`). `ExtensionFactory` takes a new last type argument, `Renders`, which annotated factories that set a renderer can pass as `true`.

Typed `run()` and `handle.run()` now type `onEvent`'s event like the outcome's `events`. Under `exactOptionalPropertyTypes`, optional fields that are often filled from optional flags accept an explicit `undefined`: prompt options such as `initial`, `default`, `placeholder`, and `theme`; typed `run()` arguments, flags, and `raw`; and `nextSteps` steps.
