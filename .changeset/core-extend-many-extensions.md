---
"@crustjs/core": patch
---

Fix `TS2589: Type instantiation is excessively deep and possibly infinite` when one `.extend(...)` call registers 45 or more Extensions. Error messages are unchanged.
