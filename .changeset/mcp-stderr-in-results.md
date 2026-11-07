---
"@crustjs/mcp": minor
---

Tool results now include what the command wrote to stderr: non-empty captured stderr follows the result as one more text block, for completed, handled, and failed calls alike, so warnings and `nextSteps()` blocks (recovery steps included) reach MCP clients. `structuredContent` and `isError` are unchanged, and calls that write nothing to stderr return the same result as before.
