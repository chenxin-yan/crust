---
"@crustjs/mcp": patch
---

Tool input schemas now omit defaults containing `Infinity`, `-Infinity`, or `NaN` instead of advertising them as `null`.
