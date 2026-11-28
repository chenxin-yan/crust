---
"@crustjs/core": minor
"@crustjs/mcp": minor
---

**Breaking:** `run()` and the action's `runCommand()` capture output exactly as written. `RunOutcome.stdout` and `.stderr` no longer drop a final newline, so `stdout("done")` captures `"done\n"`, as `captureExecute()` already does: one rule for every capture. Compare `outcome.stdout` against text that ends in the newline, such as `"done\n"`. An MCP tool's text content is the captured output as it is, so a text result or stderr block now ends in its newline.
