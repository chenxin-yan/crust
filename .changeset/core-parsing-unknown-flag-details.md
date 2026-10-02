---
"@crustjs/core": patch
---

Unknown-flag `PARSE` errors from argv now carry `details: { flag, reason: "unknown-flag" }`, matching structured `run()` input.
