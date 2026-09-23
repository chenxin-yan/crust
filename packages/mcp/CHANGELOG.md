# @crustjs/mcp

## 0.1.0

### Minor Changes

- [#439](https://github.com/chenxin-yan/crust/pull/439) [`852d4e2`](https://github.com/chenxin-yan/crust/commit/852d4e20c43edf8b5072673e917daeb32cc8bfca) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Add `@crustjs/mcp`: serve a Crust CLI as MCP tools over stdio. `mcpExtension({ app })` contributes `mcp` (stdio server whose tools are the visible, action-bearing commands, called through typed `run()`) and `mcp config --client claude|cursor|vscode` (client configuration snippet with the launch identity of the running process). `createMcpServer(app)`, `serveStdio(server)`, and the pure `toolsFromSnapshot(snapshot)` JSON Schema manifest are exported for headless use.

### Patch Changes

- [#439](https://github.com/chenxin-yan/crust/pull/439) [`852d4e2`](https://github.com/chenxin-yan/crust/commit/852d4e20c43edf8b5072673e917daeb32cc8bfca) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Omit unserializable tool defaults and preserve captured stdout when action-result inspection or serialization throws. Detach serialized metadata and results before passing them to the MCP transport.

- [#439](https://github.com/chenxin-yan/crust/pull/439) [`852d4e2`](https://github.com/chenxin-yan/crust/commit/852d4e20c43edf8b5072673e917daeb32cc8bfca) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Forward MCP request cancellation to command invocations and preserve source runtime arguments in generated client configurations. Add an explicit launch override for custom runtime setup.
- Updated dependencies [[`0e1799b`](https://github.com/chenxin-yan/crust/commit/0e1799bb99cfcc73fa24bf288068600fc01dc7bb), [`0e1799b`](https://github.com/chenxin-yan/crust/commit/0e1799bb99cfcc73fa24bf288068600fc01dc7bb)]:
  - @crustjs/core@0.4.0
