---
"@crustjs/core": patch
---

Read each supplied structured argument and flag value only once during `run()`, so own getters are not invoked again by name validation.
