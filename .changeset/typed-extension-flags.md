---
"@crustjs/core": minor
---

Infer Extension-owned flag values in `defineExtension()` hook contexts. Command-specific flags remain `unknown`, root-only flags include `undefined`, and schema-backed flags reflect their syntax-parsed values before validation.
