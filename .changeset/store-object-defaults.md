---
"@crustjs/store": patch
---

Redesign store API from field-definition schema to object-default schema. Add `dataDir`, `stateDir`, `cacheDir` XDG path helpers alongside `configDir`. Add `patch()` method for deep partial updates, `validate` option for pre-write validation, and `pruneUnknown` option for controlling unknown key behavior. Remove `FieldDef`, `FieldsDef`, `InferStoreConfig`, and `ValueType` types.
