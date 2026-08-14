---
"@crustjs/core": patch
---

Command spelling extraction now distributes over command-definition unions, so alias collision checks see aliases when definitions with and without aliases are added in the same `.add()` batch.
