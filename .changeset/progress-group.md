---
"@crustjs/progress": minor
---

Add `progressGroup()` for several determinate indicators at once. `group.add({ total, message })` returns the same handle as `progress()`; on a terminal each running indicator gets its own rows, redrawn together, and a finished one prints its final line above them, so concurrent indicators no longer overwrite one row. A message with line breaks keeps every line, one row each. Without a terminal, each indicator prints one line when it stops. The group takes `spinner`, `theme`, `sigint`, `sink`, and `signal` like `spinner()`.
