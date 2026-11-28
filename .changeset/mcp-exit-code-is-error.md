---
"@crustjs/mcp": minor
---

**Breaking:** a tool call whose command completed with a non-zero exit code, set with `exitCode(n)`, now returns `isError: true`, as the MCP specification asks for business-logic failures. Its content is unchanged: the text, `structuredContent`, and stderr are the same as before. It used to look like a success, so an agent could not tell `grep`-style "no match" or a failed check from a passing one. `toolResultFromOutcome()` applies the rule, so a custom server gets it too.
