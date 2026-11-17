---
"@crustjs/mcp": minor
---

`discovery: "progressive"` (on `mcpExtension()`, `serveStdio()`, and `createMcpServer()`) makes `tools/list` return three fixed tools instead of one per command: `search_tools({ query, limit? })` returns the best-matching tools' names and descriptions, `get_tool_details({ name })` returns one tool as `tools/list` would list it, and `call_tool({ name, arguments? })` calls it with the same result as `tools/call`. The default, `"direct"`, is unchanged. Unknown, hidden, excluded, and unincluded Extension tool names stay `InvalidParams` protocol errors.
