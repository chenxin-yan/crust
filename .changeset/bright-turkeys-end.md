---
"@crustjs/style": patch
---

Honor explicit capability overrides even when they are set to `undefined` so
auto color detection stays deterministic in tests and other controlled
environments.
