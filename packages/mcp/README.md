# @crustjs/mcp

Serve a Crust CLI as MCP tools over stdio

`mcpExtension({ app })` adds `<cli> mcp`, which serves the application's own action-bearing, visible commands as tools through typed `app.run()` (Extension commands such as `completion` only when `include` names them; Extension flags such as `--help` never), and `<cli> mcp config [--client claude|cursor|vscode]`, which prints the client configuration snippet. `serveStdio(app)` and `createMcpServer(app)` are the headless primitives; `toolsFromSnapshot(snapshot)` is the pure JSON Schema tool manifest.

## Install

```sh
npm install @crustjs/mcp
```

## Documentation

Full docs: [crustjs.com/docs/modules/mcp](https://crustjs.com/docs/modules/mcp)
