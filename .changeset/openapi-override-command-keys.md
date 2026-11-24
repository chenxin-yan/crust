---
"@crustjs/openapi": minor
---

An operation override carries the command keys installed packages own (`CommandExtras`) onto the generated command, so a generated command can be kept out of the MCP tools or given tool hints as a hand-written one is: `.override({ deleteUser: { mcp: false } })`, or `.each((op) => ({ mcp: op.method === "get" ? { readOnlyHint: true } : false }))`. The key type-checks once the project imports the package that owns it; `@crustjs/openapi` itself knows no such key.
