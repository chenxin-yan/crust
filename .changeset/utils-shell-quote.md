---
"@crustjs/utils": minor
---

`@crustjs/utils/process` exports `shellQuote(token)`, which returns a string as one POSIX shell word: unchanged when it contains only safe characters, otherwise single-quoted with apostrophes escaped. `@crustjs/mcp` and `@crustjs/extensions` share it to print commands.
