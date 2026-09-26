# @crustjs/mcp

## 0.1.1

### Patch Changes

- [#453](https://github.com/chenxin-yan/crust/pull/453) [`801b72c`](https://github.com/chenxin-yan/crust/commit/801b72cac514f4715e477fea187d07a39cc3fc44) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Fall back to captured stdout instead of returning lossy structuredContent for completed results containing -0, array holes, named or symbol array keys, Array subclasses, or non-enumerable object keys. Result getters are now read exactly once into a detached copy, so a getter that changes between reads can no longer produce structured content that differs from what was validated. New own keys or array-length changes detected during an object's capture also fall back to stdout.
- Updated dependencies [[`c4f44d6`](https://github.com/chenxin-yan/crust/commit/c4f44d6f9e3dd206154d0b18a84fb75464dc2dfe), [`eb9928d`](https://github.com/chenxin-yan/crust/commit/eb9928d60edc3033652ad55a3a019e790dafdf06)]:
  - @crustjs/core@0.5.0

## 0.1.0

### Minor Changes

- [#439](https://github.com/chenxin-yan/crust/pull/439) [`852d4e2`](https://github.com/chenxin-yan/crust/commit/852d4e20c43edf8b5072673e917daeb32cc8bfca) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Add `@crustjs/mcp`: serve a Crust CLI as MCP tools over stdio. `mcpExtension({ app })` contributes `mcp` (stdio server whose tools are the visible, action-bearing commands, called through typed `run()`) and `mcp config --client claude|cursor|vscode` (client configuration snippet with the launch identity of the running process). `createMcpServer(app)`, `serveStdio(server)`, and the pure `toolsFromSnapshot(snapshot)` JSON Schema manifest are exported for headless use.

### Patch Changes

- [#439](https://github.com/chenxin-yan/crust/pull/439) [`852d4e2`](https://github.com/chenxin-yan/crust/commit/852d4e20c43edf8b5072673e917daeb32cc8bfca) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Omit unserializable tool defaults and preserve captured stdout when action-result inspection or serialization throws. Detach serialized metadata and results before passing them to the MCP transport.

- [#439](https://github.com/chenxin-yan/crust/pull/439) [`852d4e2`](https://github.com/chenxin-yan/crust/commit/852d4e20c43edf8b5072673e917daeb32cc8bfca) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Forward MCP request cancellation to command invocations and preserve source runtime arguments in generated client configurations. Add an explicit launch override for custom runtime setup.
- Updated dependencies [[`0e1799b`](https://github.com/chenxin-yan/crust/commit/0e1799bb99cfcc73fa24bf288068600fc01dc7bb), [`0e1799b`](https://github.com/chenxin-yan/crust/commit/0e1799bb99cfcc73fa24bf288068600fc01dc7bb)]:
  - @crustjs/core@0.4.0
