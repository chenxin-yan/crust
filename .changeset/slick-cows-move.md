---
"@crustjs/store": minor
---

Breaking: Return successful schema output on reads without writing, and validate/resolve current state before calling update callbacks. Use write or patch to initialize or repair invalid state. Reject undefined mutations for defaulted core fields while retaining optional fields and schema-owned defaults. Normalize cyclic serialization failures as field-scoped VALIDATION errors.
