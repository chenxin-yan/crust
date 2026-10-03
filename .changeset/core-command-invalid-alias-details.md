---
"@crustjs/core": patch
---

Invalid command aliases now throw a `DEFINITION` error with `details` (`reason: "invalid-alias"`), like every other definition error.
