---
"@crustjs/prompts": minor
---

Removed the `stripAnsi` re-export from `@crustjs/prompts/testing`. It was a one-line wrapper around Node's `stripVTControlCharacters`; import that from `node:util` (or use `Bun.stripANSI()`) instead.
