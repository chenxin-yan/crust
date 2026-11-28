---
"@crustjs/mcp": minor
---

**Breaking:** `mcpExtension()` is renamed `mcp()`, takes no `app` option, and a command's own `mcp` key replaces the `exclude` option.

- `mcp` serves the application it runs in, read from its action's `rootCommand` and run through `runCommand`. Replace `.extend(mcpExtension({ app: (): AnyCrust => app }))` with `.extend(mcp())`; the self-reference and its annotation go away, and commands added after `.extend(mcp())` are tools too. `createMcpServer(app)` and `serveStdio(app)` still take the application, for serving outside a CLI.
- `mcp?: false | { title?, readOnlyHint?, destructiveHint?, idempotentHint?, openWorldHint? }` on command metadata, for `defineCommand()` and inline `.command()`. `mcp: false` keeps the command and everything under it out of the tools; replace `exclude: [["wipe"]]` with `mcp: false` on `wipe`. An object becomes the tool's MCP `annotations`, which Crust could not set before. A command that sets the key in an application that does not install `mcp()` is a `DEFINITION` error (`unowned-key`), also when served with `createMcpServer()`.
- `include` stays, and `mcp: false` wins over it. `McpTool` gains `annotations`, and `McpToolAnnotations` is exported.

See [MCP](https://crustjs.com/docs/modules/mcp).
