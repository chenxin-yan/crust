---
"@crustjs/prompts": minor
---

Removed the `stripAnsi` re-export from `@crustjs/prompts/testing`. It was a one-line wrapper around Node's `stripVTControlCharacters`; import `stripVTControlCharacters` from `node:util` instead.
