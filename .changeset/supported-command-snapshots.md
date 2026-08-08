---
"@crustjs/core": minor
"@crustjs/man": minor
---

Add `Crust.snapshot()` as the supported API for preparing a frozen, validated Command Snapshot with Extension contributions and command definitions materialized without calling Command Actions.

Remove `prepareCommandSnapshot` from `@crustjs/core/tooling`. Tooling consumers should call `app.snapshot()` instead; the tooling subpath now exports the `CommandSnapshot` type for structural consumers.

Update `writeManPage()` so its `app` option requires a structural `snapshot()` method instead of access to Crust's internal `_node` field.
