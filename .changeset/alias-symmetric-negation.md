---
"@crustjs/core": minor
---

Boolean negation is now alias-symmetric: `--no-<alias>` works for every long alias, matching what man pages and completion scripts already advertised. `noNegate: true` is now enforced by the parser — negating a `noNegate` boolean via any spelling is a `PARSE` error instead of being silently accepted.
