---
"@crustjs/core": patch
"@crustjs/plugins": patch
---

Introduce the v0.1 beta API direction for core with typed contexts via `context()` + `.context()`, CLI extensions via `.extend()`, parent-typed split commands, cloned runtime tree execution, a custom parser, and tagged `CrustError` metadata. Add extension-style helpers in `@crustjs/plugins` while keeping `new Crust()` as the single command-authoring style.
