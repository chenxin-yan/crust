---
"@crustjs/core": minor
"@crustjs/utils": minor
---

`@crustjs/core/tooling` exports the command <-> JSON input mapping that `@crustjs/mcp` used internally. `commandInputSchema(command, path)` describes a command's input as one flat JSON Schema object (each arg and flag by name, plus `raw` for passthrough values), and `parseCommandInput(command, values)` turns such an object into structured `run()` input, converting `url` strings to `URL`s (an invalid one fails with the same `PARSE` error as argv, `Invalid URL for --name.`). Also exported: `commandInputFields(command)` (the arg and `url` field names that split uses), `RAW_INPUT_PROPERTY`, and the `CommandInputFields`, `CommandInputSchema`, `CommandInputPropertySchema`, `RunInputPayload`, and `RunInputValue` types. `@crustjs/utils/json` exports `parseJsonValue(value)`, which returns a detached copy of plain JSON data (reading each property once) and throws a `TypeError` for anything JSON would not round-trip, such as `undefined`, `NaN`, class instances, array holes, or cycles (`-0` is the one exception: it is kept, though `JSON.stringify` writes it as `0`); core uses it for this input and `@crustjs/mcp` for tool results.
