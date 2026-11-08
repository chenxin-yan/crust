---
"@crustjs/core": minor
---

A `Renderer` can render cleanup failures with a new optional `cleanup(error)` member. In `execute()`, Core calls it once for each cleanup failure it used to print as plain `Cleanup failed: …` lines: a Context disposal or deferred cleanup that fails after a failure was already rendered, and cleanup that fails while a cancellation unwinds. Without `cleanup`, or if it throws, Core prints its plain lines as before, so a cleanup failure is never hidden. Exit codes and `run()` are unchanged.
