# @crustjs/mcp

Serve a Crust CLI as MCP tools over stdio

`mcpExtension({ app })` adds `<cli> mcp`, which serves every action-bearing, visible command as a tool through typed `app.run()`, and `<cli> mcp config [--client claude|cursor|vscode]`, which prints the client configuration snippet. `createMcpServer(app)` and `serveStdio(server)` are the headless primitives; `toolsFromSnapshot(snapshot)` is the pure JSON Schema tool manifest.

## Install

```sh
npm install @crustjs/mcp
```

## Documentation

Full docs: [crustjs.com/docs/modules/mcp](https://crustjs.com/docs/modules/mcp)
