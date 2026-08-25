---
"@crustjs/store": minor
---

Tighten the store definition, persistence, and error surface (breaking).

- `name` is required when creating a store; the implicit `config.json` filename is removed. Pass `name: "config"` to preserve the previous file path.
- Schema-backed fields standardize on the plain `{ schema }` shape; the `field()` factory is removed. Migrate `field(Port, { default: 3000 })` to `{ schema: Port.default(3000) }`. Standard Schemas exclusively own validation, transformation, defaults, and optionality — `default` and `validate` cannot be mixed with `schema`, and `type` metadata no longer coerces persisted strings before validation (move coercion into the schema, e.g. `z.coerce.number()`). Schema-backed field types follow the schema's `InferOutput` exactly, and schemas may output named interfaces when every property is recursively JSON-compatible.
- Core field definitions require a declared primitive `type`. Persisted core values that still mismatch that type after coercion are rejected, as are non-finite built-in numbers before persistence.
- Field validators accept only the documented `void` or exact `{ value }` result contracts; explicit migration errors for legacy validator result shapes are removed. Hand-written `validate` transforms are typed to return the field's declared type and are re-checked at runtime.
- `write()`, `update()`, and `patch()` return the config they persisted, including schema transformations, and reject values JSON serialization would alter: `NaN`, `Infinity`, `-0`, sparse arrays, and `undefined` object properties.
- `CrustStoreError.withCause()` is replaced by the constructor's optional final `cause` argument, `DEFINITION` error details are optional, and the `DefinitionErrorDetails` type export is removed. The internal `PlatformEnv` type is no longer exported.
- A persisted config file with a non-object JSON root — string, number, array, or `null` — throws a `PARSE` `CrustStoreError`; previously strings and numbers crashed with a raw `TypeError`, while arrays and `null` silently reset the store to defaults.
- Store path resolution trusts its typed contract: untyped JavaScript callers passing a non-string `dirPath`, `name`, or `appName` get a `TypeError` instead of `CrustStoreError("PATH")`; typed callers are unaffected.
- Raw JSON field defaults are deep-copied when applied, so nested objects and arrays cannot leak mutations between reads.
