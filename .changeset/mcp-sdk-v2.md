---
"@crustjs/mcp": patch
---

`<cli> mcp` now speaks MCP protocol revision 2026-07-28, on version 2 of the MCP TypeScript SDK (`@modelcontextprotocol/server`, which replaces `@modelcontextprotocol/sdk`).

- A client that supports 2026-07-28 is served that revision: `server/discover` instead of the `initialize` handshake, `resultType` on every result, and `ttlMs` and `cacheScope` on `tools/list`.
- A client that opens with `initialize` is served the revision it asks for, 2025-11-25 or earlier, as before. The opening exchange decides; there is nothing to configure.
- Tools, schemas, results, and progress notifications are the same under every revision. Arrays and primitives stay wrapped as `{ "result": value }` in `structuredContent`, which revisions before 2026-07-28 require.

**Behavior change:** `serveStdio()` takes the application instead of a server, because the SDK builds the server for the revision the client opens with: write `serveStdio(app, options)` where you wrote `serveStdio(await createMcpServer(app, options))`. `createMcpServer()` returns the `Server` class of `@modelcontextprotocol/server`, which speaks 2025-11-25 and earlier only when you connect it to a transport yourself. Applications that only use `mcpExtension()` need no change.

**Behavior change:** the error for an unknown tool reads `Tool <name> not found` where it read `MCP error -32602: Tool <name> not found`; its code is still `-32602`. A protocol message larger than 10 MB now closes the connection. The SDK dependency is licensed Apache-2.0 where version 1 was MIT.
