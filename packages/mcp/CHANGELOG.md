# @crustjs/mcp

## 0.1.2

### Patch Changes

- [`3b9245a`](https://github.com/chenxin-yan/crust/commit/3b9245a765fd48ef0625c22d1991b7cd6a91dc45) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Update MCP SDK and the supported Effect RC and OpenTUI dependency versions.

- [#469](https://github.com/chenxin-yan/crust/pull/469) [`1984299`](https://github.com/chenxin-yan/crust/commit/1984299962d29641ed1b9741f1ed252a1b3f8e1b) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Raise the minimum supported Node.js version to 24. Remove the Node 22 disposal-stack fallback and use native AsyncDisposableStack on all supported runtimes. Update generated Node projects to require Node 24 and use @types/node 24.

## 0.1.1

### Patch Changes

- [#453](https://github.com/chenxin-yan/crust/pull/453) [`801b72c`](https://github.com/chenxin-yan/crust/commit/801b72cac514f4715e477fea187d07a39cc3fc44) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Fall back to captured stdout instead of returning lossy structuredContent for completed results containing -0, array holes, named or symbol array keys, Array subclasses, or non-enumerable object keys. Result getters are now read exactly once into a detached copy, so a getter that changes between reads can no longer produce structured content that differs from what was validated. New own keys or array-length changes detected during an object's capture also fall back to stdout.
- Updated dependencies [[`bc3cbb2`](https://github.com/chenxin-yan/crust/commit/bc3cbb250974fcdba4ce2f50ee4b6b90a1f16c30), [`c4f44d6`](https://github.com/chenxin-yan/crust/commit/c4f44d6f9e3dd206154d0b18a84fb75464dc2dfe), [`0b835c2`](https://github.com/chenxin-yan/crust/commit/0b835c20b9bcf09e9dea7f179eeecd43a9c50763), [`eb9928d`](https://github.com/chenxin-yan/crust/commit/eb9928d60edc3033652ad55a3a019e790dafdf06), [`4977f33`](https://github.com/chenxin-yan/crust/commit/4977f33e87a928d968202af40f9729e390b7df93)]:
  - @crustjs/core@0.5.0

## 0.1.0

### Minor Changes

- [#439](https://github.com/chenxin-yan/crust/pull/439) [`852d4e2`](https://github.com/chenxin-yan/crust/commit/852d4e20c43edf8b5072673e917daeb32cc8bfca) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Add `@crustjs/mcp`: serve a Crust CLI as MCP tools over stdio. `mcpExtension({ app })` contributes `mcp` (stdio server whose tools are the visible, action-bearing commands, called through typed `run()`) and `mcp config --client claude|cursor|vscode` (client configuration snippet with the launch identity of the running process). `createMcpServer(app)`, `serveStdio(server)`, and the pure `toolsFromSnapshot(snapshot)` JSON Schema manifest are exported for headless use.

### Patch Changes

- [#439](https://github.com/chenxin-yan/crust/pull/439) [`852d4e2`](https://github.com/chenxin-yan/crust/commit/852d4e20c43edf8b5072673e917daeb32cc8bfca) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Omit unserializable tool defaults and preserve captured stdout when action-result inspection or serialization throws. Detach serialized metadata and results before passing them to the MCP transport.

- [#439](https://github.com/chenxin-yan/crust/pull/439) [`852d4e2`](https://github.com/chenxin-yan/crust/commit/852d4e20c43edf8b5072673e917daeb32cc8bfca) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Forward MCP request cancellation to command invocations and preserve source runtime arguments in generated client configurations. Add an explicit launch override for custom runtime setup.
- Updated dependencies [[`0e1799b`](https://github.com/chenxin-yan/crust/commit/0e1799bb99cfcc73fa24bf288068600fc01dc7bb), [`0e1799b`](https://github.com/chenxin-yan/crust/commit/0e1799bb99cfcc73fa24bf288068600fc01dc7bb)]:
  - @crustjs/core@0.4.0
