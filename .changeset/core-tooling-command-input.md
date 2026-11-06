---
"@crustjs/core": minor
---

`@crustjs/core/tooling` exports the command <-> JSON input mapping that `@crustjs/mcp` used internally. `commandInputSchema(command, path)` describes a command's input as one flat JSON Schema object (each arg and flag by name, plus `raw` for passthrough values), and `parseCommandInput(command, values)` turns such an object into structured `run()` input, converting `url` strings to `URL`s. Also exported: `RAW_INPUT_PROPERTY` and the `CommandInputSchema`, `CommandInputPropertySchema`, `RunInputPayload`, and `RunInputValue` types.
