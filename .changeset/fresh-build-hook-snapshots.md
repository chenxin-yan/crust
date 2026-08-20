---
"@crustjs/core": patch
---

Refresh command snapshots between Extension build hooks so later artifact generators see sections derived from earlier hooks' outputs, including generated skills, instead of unavailable-source fallbacks.
