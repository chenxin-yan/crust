---
"@crustjs/core": patch
---

Adapter hook: expose bag sources and instance factory. Context bags carry their sources under the non-enumerable `contextSources` symbol, and Context instances expose their defining `factory`.
