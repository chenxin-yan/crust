---
"@crustjs/mcp": minor
---

Add `@crustjs/mcp`: serve a Crust CLI as MCP tools over stdio. `mcpExtension({ app })` contributes `mcp` (stdio server whose tools are the visible, action-bearing commands, called through typed `run()`) and `mcp config --client claude|cursor|vscode` (client configuration snippet with the launch identity of the running process). `createMcpServer(app)`, `serveStdio(server)`, and the pure `toolsFromSnapshot(snapshot)` JSON Schema manifest are exported for headless use.
