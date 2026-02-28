---
"@crustjs/store": patch
"@crustjs/validate": patch
---

Redesign store to use fields-based API with per-field validation

- Replaced `defaults` option with `fields` containing `type`, `default` (optional), and `validate` (optional)
- Fields without `default` are typed as `T | undefined` and skip validation when undefined
- Fields with `default` are typed as their primitive type (guaranteed present)
- Removed top-level `validator` option from `CreateStoreOptions`
- `patch` now uses `Partial<T>` (shallow) instead of `DeepPartial<T>`
- Validation runs on `read`, `write`, `update`, and `patch` operations
- Per-field validation collects all issues before throwing single `CrustStoreError("VALIDATION")`
- Renamed `storeValidator`/`storeValidatorSync` to `field`/`fieldSync` for less verbose DX
