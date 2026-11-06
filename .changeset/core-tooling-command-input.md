---
"@crustjs/core": minor
---

`@crustjs/core/tooling` exports the command <-> JSON input mapping that `@crustjs/mcp` used internally. `commandInputSchema(command, path)` describes a command's input as one flat JSON Schema object (each arg and flag by name, plus `raw` for passthrough values), and `parseCommandInput(command, values)` turns such an object into structured `run()` input, converting `url` strings to `URL`s. Also exported: `commandInputFields(command)` (the arg and `url` field names that split uses), `RAW_INPUT_PROPERTY`, and the `CommandInputFields`, `CommandInputSchema`, `CommandInputPropertySchema`, `RunInputPayload`, and `RunInputValue` types.
