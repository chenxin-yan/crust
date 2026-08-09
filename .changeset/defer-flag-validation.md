---
"@crustjs/core": patch
---

Faster type-checking for `.flags()` calls: flag validation is now deferred behind a distributive conditional so the pipeline is only instantiated once definitions are concrete (−8.8% type instantiations on the core package). Emitted validation brands are unchanged.
