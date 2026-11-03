---
"@crustjs/core": patch
---

Fix `TS2589: Type instantiation is excessively deep and possibly infinite` when one `.provide(...)`, `.extend(...)` or command `.use(...)` call brings in 46 or more Contexts. `.provide()` covers both apps and Extensions; `.extend()` covers an Extension that provides that many Contexts. Error messages are unchanged.
