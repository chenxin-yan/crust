---
"@crustjs/mcp": patch
---

Read whether a tool input is required from the command snapshot, like help, man pages, skills, and completion. The snapshot now omits `required` when a default makes the value optional, so MCP no longer repeats that rule itself.
