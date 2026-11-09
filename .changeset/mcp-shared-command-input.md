---
"@crustjs/mcp": patch
---

Build tool input schemas and parse tool arguments with `@crustjs/core/tooling`'s `commandInputSchema()` and `parseCommandInput()`. Tool listings and argument handling are unchanged; the error for an arg and a flag sharing a name, or a definition named `raw`, now ends with "command input is one flat object" instead of "MCP tool input is one flat object".
