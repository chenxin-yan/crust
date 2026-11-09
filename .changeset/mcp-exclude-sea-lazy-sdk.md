---
"@crustjs/mcp": patch
"@crustjs/utils": patch
---

`createMcpServer()` and `toolsFromSnapshot()` now throw when an `exclude` path is not a canonical command path, listing each unknown path, so a bad `mcpExtension({ exclude })` path fails when the `mcp` server starts. Previously a misspelled path or an alias was silently ignored and the command stayed exposed as an MCP tool.

`mcp config` now detects a Node single executable application as a compiled executable and prints `<executable> mcp` instead of passing the executable path back to itself as an entry.

`@crustjs/mcp` loads the MCP SDK only when the server starts, so importing the package (and every command of a CLI using `mcpExtension`) no longer pays the SDK's load time.
