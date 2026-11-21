---
"@crustjs/mcp": minor
---

`discovery: "progressive"` (on `mcpExtension()`, `serveStdio()`, and `createMcpServer()`, typed `McpServerOptions`; `toolsFromSnapshot()` does not take it) makes `tools/list` return three fixed tools instead of one per command: `search_tools({ query, limit? })` returns the best-matching tools' names and descriptions (command names, then descriptions, then argument and flag names by descending base weight, all else equal, with words most tools share weighing least), `get_tool_details({ name })` returns one tool as `tools/list` would list it, and `call_tool({ name, arguments? })` calls it with the same result as `tools/call`. The default, `"direct"`, is unchanged. Unknown, hidden, excluded, and unincluded Extension tool names stay `InvalidParams` protocol errors.
