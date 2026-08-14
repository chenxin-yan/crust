---
"@crustjs/core": patch
---

Command hint extraction now distributes over command-definition unions, so aliases survive when definitions with and without aliases are added in the same `.add()` batch.
