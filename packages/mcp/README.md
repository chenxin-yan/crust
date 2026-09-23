# @crustjs/mcp

Serve a Crust CLI as MCP tools over stdio, with no per-command glue.

`mcpExtension({ app })` adds `<cli> mcp`, which serves every action-bearing, visible command as a tool through typed `app.run()`, and `<cli> mcp config`, which prints the client configuration snippet. `createMcpServer(app)` and `serveStdio(server)` are the headless primitives; `toolsFromSnapshot(snapshot)` is the pure JSON Schema tool manifest.

## Install

```sh
npm install @crustjs/mcp
```

## Client configuration

`<cli> mcp config` prints the snippet for the process that runs it: a compiled binary is its own `command`; a source entry or bundle is relaunched through its runtime.

```sh
my-cli mcp config                   # Claude Code / Claude Desktop (default)
my-cli mcp config --client cursor   # Cursor
my-cli mcp config --client vscode   # VS Code (.vscode/mcp.json)
```

```json
{ "mcpServers": { "my-cli": { "type": "stdio", "command": "my-cli", "args": ["mcp"] } } }
```

VS Code reads the same entry under `servers`. Claude Code can also register it directly:

```sh
claude mcp add my-cli -- my-cli mcp
```

## Documentation

Full docs: [crustjs.com/docs/modules/mcp](https://crustjs.com/docs/modules/mcp)
