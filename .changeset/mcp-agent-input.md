---
"@crustjs/core": patch
"@crustjs/mcp": patch
"@crustjs/utils": patch
---

MCP tools and command input now match what a command actually receives.

- Tool input schemas and `schema <cmd>` no longer list flags an Extension declares, such as `help`, `json`, `input`, `llms`, or `color`; Context-owned flags such as `confirm()`'s `yes` stay. `CommandSnapshot` and `FlagSnapshot` gain an `extension` field naming the Extension that contributed a command or flag. Sending such a key in a tool call or in `--input` JSON fails with `Unknown flag "--json"`, so `{"input": "-"}` can no longer read the MCP server's stdin and stall the session.
- MCP tool calls now apply flag `env` fallbacks: a flag the input omits reads its variable from the server's `process.env`, then its default, as on the command line, so an MCP client's `env` configuration reaches tool calls. Env-backed flags are optional in tool input schemas, with the variable named in their description.
- `run()` gains an `env` option with the same fallback: `app.run(path, input, { env: { API_TOKEN: "t" } })`. `run()` never reads `process.env` itself, so results don't depend on the caller's shell; pass `{ env: process.env }` to resolve like the terminal. Env-backed flags are optional in typed `run()` input.
- `mcpExtension()`, `createMcpServer()`, and `toolsFromSnapshot()` serve only the application's own commands. Extension commands such as `completion`, `schema`, and `skills uninstall` become tools only when the new `include` option names them.
- `readStdin()` from `@crustjs/utils/process` rejects with `stdin is in use by another reader` while another reader, such as the MCP stdio transport, consumes stdin.

**Behavior change:** `--input` JSON that set `json` or `help` now fails; pass those flags on argv. MCP clients lose the Extension commands from their tool list unless `include` names them.
