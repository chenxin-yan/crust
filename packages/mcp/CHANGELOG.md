# @crustjs/mcp

## 0.2.0

### Minor Changes

- [#567](https://github.com/chenxin-yan/crust/pull/567) [`2821b47`](https://github.com/chenxin-yan/crust/commit/2821b479175e77e513330ac5100b50ac159573a7) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Breaking: the `McpServerOptions` alias is removed; `createMcpServer()` takes `McpToolsOptions`, the type it already was.

### Patch Changes

- [#586](https://github.com/chenxin-yan/crust/pull/586) [`484e055`](https://github.com/chenxin-yan/crust/commit/484e0552aeadbaa4103bc61553f1183ee25b212c) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Tokens after `--` now fill positional arguments. A positional value that starts with `-` can be passed after `--`, so `seek -- -5` binds `-5` to the first positional argument. Before, `seek -5` failed with `Unknown flag`, and `seek -- -5` left `-5` in `rawArgs`, so a required positional argument was reported missing. Tokens after `--` still never parse as flags.
  
  **Behavior change:** declared positional arguments that are still unfilled take tokens after `--` first, and only the remaining tokens reach the action as `rawArgs`. A command without positional arguments keeps receiving every token after `--` in `rawArgs`. A command with an optional or variadic positional argument now binds the first token after `--` (or all of them, for a variadic argument) to that argument. For example, `wrap [target] -- --watch src` now sets `target` to `--watch` and `rawArgs` to `["src"]`, where `target` used to be `undefined` and `rawArgs` held both tokens. To keep forwarding everything after `--`, pass every non-variadic positional value before `--`, or read them from `rawArgs` and drop the positional argument. A variadic positional argument now takes every token after `--` (`wrap src -- --watch` with `files...` sets `files` to `["src", "--watch"]`), so a command that forwards `rawArgs` should not declare one. `run()`'s `raw` input is unchanged and never fills `args`.
  
  The MCP tool schema's `raw` description no longer says its values act as if written after `--`; they are received as `rawArgs` and never fill arguments.

- [#539](https://github.com/chenxin-yan/crust/pull/539) [`ce12aed`](https://github.com/chenxin-yan/crust/commit/ce12aed7a34275c49b54340d1995378afedfa2a6) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Drop Deno support. Crust now targets Bun and Node.js only.
  
  - `@crustjs/crust`: `crust.runtime: "deno"` and Deno targets are removed; `deno.json`/`deno.jsonc` no longer selects a runtime. `--minify` now defaults to `true` in `--help`.
  - `create-crust`: `--runtime deno` is no longer accepted.
  - `@crustjs/utils`: `PACKAGED_BUILD_KEY` and `isPackagedBuild` are removed from `@crustjs/utils/artifacts`, and Deno compiled executables are no longer detected.
  - `@crustjs/core`: the snapshot protocol no longer checks the packaged-build marker.
  - `@crustjs/mcp`: Deno standalone builds are no longer detected as compiled executables.

- [#517](https://github.com/chenxin-yan/crust/pull/517) [`4a4386d`](https://github.com/chenxin-yan/crust/commit/4a4386d64fdef5440e77cebd8b9ac85e7a1d7350) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - `createMcpServer()` and `toolsFromSnapshot()` now throw when an `exclude` path is not a canonical command path, listing each unknown path, so a bad `mcpExtension({ exclude })` path fails when the `mcp` server starts. Previously a misspelled path or an alias was silently ignored and the command stayed exposed as an MCP tool.
  
  `mcp config` now detects a Node single executable application as a compiled executable and prints `<executable> mcp` instead of passing the executable path back to itself as an entry.
  
  `@crustjs/mcp` loads the MCP SDK only when the server starts, so importing the package (and every command of a CLI using `mcpExtension`) no longer pays the SDK's load time.

- [#511](https://github.com/chenxin-yan/crust/pull/511) [`27f5832`](https://github.com/chenxin-yan/crust/commit/27f583260be2ad90544dd85d5653f7ab23255cff) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Read whether a tool input is required from the command snapshot, like help, man pages, skills, and completion. The snapshot now omits `required` when a default makes the value optional, so MCP no longer repeats that rule itself.
- Updated dependencies [[`6fdb8a6`](https://github.com/chenxin-yan/crust/commit/6fdb8a642b79a176d60d9a3d4be3431493201052), [`6a7e073`](https://github.com/chenxin-yan/crust/commit/6a7e073c4cb59452a03f41cbe656fd03e2b56dc9), [`a805be3`](https://github.com/chenxin-yan/crust/commit/a805be3923e60e64e34fb3ac49a41b9f4b7cf71a), [`fd54147`](https://github.com/chenxin-yan/crust/commit/fd541473c362c3f0c1054513ca00bbd681287d78), [`3c78cc9`](https://github.com/chenxin-yan/crust/commit/3c78cc9cc461be383551f599e838cb1e7253a4a1), [`4f4d9e9`](https://github.com/chenxin-yan/crust/commit/4f4d9e9eb44a7f43577bfd883ae7959dd112ac64), [`8bf19e2`](https://github.com/chenxin-yan/crust/commit/8bf19e2627ccf49a74792ae84d363718ebc04b9f), [`cc3048c`](https://github.com/chenxin-yan/crust/commit/cc3048cb281e4f6cf556e81ed7358d7e2fb0e52c), [`484e055`](https://github.com/chenxin-yan/crust/commit/484e0552aeadbaa4103bc61553f1183ee25b212c), [`2821b47`](https://github.com/chenxin-yan/crust/commit/2821b479175e77e513330ac5100b50ac159573a7), [`6e4e59b`](https://github.com/chenxin-yan/crust/commit/6e4e59bfa71d72daf39ceebc752e27d29b0449af), [`014d5aa`](https://github.com/chenxin-yan/crust/commit/014d5aa41499d1a0cc69f83589a0ff7a0f0432c7), [`46ab354`](https://github.com/chenxin-yan/crust/commit/46ab3549974b98b36329471cf212e3171e8fdf5e), [`da6dace`](https://github.com/chenxin-yan/crust/commit/da6dacef13b95abcbe5472ebaf1de441cddb0003), [`0a2c6b1`](https://github.com/chenxin-yan/crust/commit/0a2c6b198b07b693789f10a4c0532f27b94a6a9d), [`8544498`](https://github.com/chenxin-yan/crust/commit/854449869f795f00505952dc04d653f2e7f6f923), [`d5a9522`](https://github.com/chenxin-yan/crust/commit/d5a9522f11836b7c6beac79901f87f6d74d608a2), [`4208178`](https://github.com/chenxin-yan/crust/commit/420817832f065c875e836b86deac832f84d86828), [`7e2da48`](https://github.com/chenxin-yan/crust/commit/7e2da482af5a21d27a2d32839a051cc6e0c36974), [`e974d05`](https://github.com/chenxin-yan/crust/commit/e974d05834785604ed16551613baec9e7a961c4a), [`9592652`](https://github.com/chenxin-yan/crust/commit/95926524d877ebc6d20307095408bac2f5fa95d4), [`0ab1ca1`](https://github.com/chenxin-yan/crust/commit/0ab1ca1e69caa38a872a2cf36266b200664d5228), [`8ff9c6a`](https://github.com/chenxin-yan/crust/commit/8ff9c6abeaf3b89adb90f72c533d98d5c13ccce9), [`48823e8`](https://github.com/chenxin-yan/crust/commit/48823e82c50f583b990b99f49f5441bcf0280723), [`09a6808`](https://github.com/chenxin-yan/crust/commit/09a68080e8809b507dbcd0c581bd9942b186f44b), [`02993c7`](https://github.com/chenxin-yan/crust/commit/02993c71a43cafa1cbbd9853bf00e991efccb1cb), [`3273ceb`](https://github.com/chenxin-yan/crust/commit/3273ceb045554c446ac7da4937885700bf349d17), [`97e8def`](https://github.com/chenxin-yan/crust/commit/97e8def311a44507f4c06f16843f840bfa587d12), [`d863ca6`](https://github.com/chenxin-yan/crust/commit/d863ca674800fe6a1595187378129c2bef86a9f6), [`75555f3`](https://github.com/chenxin-yan/crust/commit/75555f37d8624114c02cf8af3cace0e6826aef02), [`34df0c6`](https://github.com/chenxin-yan/crust/commit/34df0c604910ceab083a7e88910cc510da4a5c5a), [`6fdb8a6`](https://github.com/chenxin-yan/crust/commit/6fdb8a642b79a176d60d9a3d4be3431493201052), [`27f5832`](https://github.com/chenxin-yan/crust/commit/27f583260be2ad90544dd85d5653f7ab23255cff), [`ce12aed`](https://github.com/chenxin-yan/crust/commit/ce12aed7a34275c49b54340d1995378afedfa2a6), [`1880c41`](https://github.com/chenxin-yan/crust/commit/1880c4108324d215baca5528a39ac779ec99329d), [`643beb2`](https://github.com/chenxin-yan/crust/commit/643beb264f5b206177110dd947b258f47cc68073), [`3f0db61`](https://github.com/chenxin-yan/crust/commit/3f0db6189a1e33d3c5e9dbee44624feadc8a7cb0), [`aad9c15`](https://github.com/chenxin-yan/crust/commit/aad9c156dd89b3283e73cb420aac724d2f3598eb), [`708e181`](https://github.com/chenxin-yan/crust/commit/708e181f0de97b81b77d64261f754e2649af1761), [`4e2c3d7`](https://github.com/chenxin-yan/crust/commit/4e2c3d73577561d447e0ef58f7fc521b8a6fa3fa), [`1880c41`](https://github.com/chenxin-yan/crust/commit/1880c4108324d215baca5528a39ac779ec99329d), [`4a4386d`](https://github.com/chenxin-yan/crust/commit/4a4386d64fdef5440e77cebd8b9ac85e7a1d7350), [`4208178`](https://github.com/chenxin-yan/crust/commit/420817832f065c875e836b86deac832f84d86828), [`0cf0914`](https://github.com/chenxin-yan/crust/commit/0cf091408ad9e1251b6e8f42712b20299e591309), [`71cd6dd`](https://github.com/chenxin-yan/crust/commit/71cd6dd8b0e5af788e11ccd68616b3c7b1c693ba), [`d64f307`](https://github.com/chenxin-yan/crust/commit/d64f30727fd3d28dcb26b7edeb6aed929a3efe19), [`e802ec7`](https://github.com/chenxin-yan/crust/commit/e802ec7c09c6635d77716e3c1c545faa99fe7759), [`7811b12`](https://github.com/chenxin-yan/crust/commit/7811b12f73827e1d47a1574c4b88736eb82632b0), [`3a6dbb1`](https://github.com/chenxin-yan/crust/commit/3a6dbb1702cff684c17054cd476ddef0b5d56f99)]:
  - @crustjs/utils@0.3.0
  - @crustjs/core@0.6.0

## 0.1.4

### Patch Changes

- [#494](https://github.com/chenxin-yan/crust/pull/494) [`f88cb79`](https://github.com/chenxin-yan/crust/commit/f88cb7961993b0db60fe2376bd33ae1d8e34837d) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Require `@modelcontextprotocol/sdk` ^1.32.1.

## 0.1.3

### Patch Changes

- [#483](https://github.com/chenxin-yan/crust/pull/483) [`e7db3a0`](https://github.com/chenxin-yan/crust/commit/e7db3a0dec77bd5bff375275daa3c83e5a350444) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Tool input schemas now omit defaults containing `Infinity`, `-Infinity`, or `NaN` instead of advertising them as `null`.

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
