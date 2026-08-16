---
"@crustjs/core": patch
---

Run registered Extension build hooks through the internal Command Snapshot subprocess protocol so build tooling can execute Extension-owned artifact generators without serializing their closures.
