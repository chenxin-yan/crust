---
"@crustjs/mcp": minor
---

Tools advertise more agent metadata: commands with a representable `.output()` schema carry an `outputSchema` matching their `structuredContent` (object schemas as is, non-object schemas wrapped as `{ result }`; a schema that may describe an object or not, such as one without a top-level `type`, and a non-object schema that wrapping would break, such as one with a `$ref` outside `#/$defs/` or an `$id`, are not advertised), and their calls that end with only captured stdout return `isError`, since MCP requires `structuredContent` from them; calls with a `progressToken` receive a `notifications/progress` for each event an async generator action yields (string events become the `message`). Schema-backed args and flags are now described by their schema's input JSON Schema when `run()` accepts that shape, through `commandInputSchema()`.
