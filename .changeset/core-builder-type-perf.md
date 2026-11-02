---
"@crustjs/core": patch
---

Speed up type-checking of command definitions and `.add()` chains. A 100-command app with typed `run()` calls now costs about 1.1M type instantiations instead of 1.8M (−38%), and one `.add()` of 50 definitions about 1.0M instead of 2.0M. Compile-time error messages are unchanged.
