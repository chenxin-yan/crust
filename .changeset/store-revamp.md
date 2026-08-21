---
"@crustjs/store": minor
---

Tighten the store definition and error surface (breaking).

- `name` is required when creating a store; the implicit `config.json` filename is removed. Pass `name: "config"` to preserve the previous file path.
- Schema-backed fields standardize on the plain `{ schema }` shape; the `field()` factory is removed. Migrate `field(Port, { default: 3000 })` to `{ schema: Port.default(3000) }`. Standard Schemas exclusively own validation, transformation, defaults, and optionality — `default` and `validate` cannot be mixed with `schema`, and `type` metadata no longer coerces persisted strings before validation (move coercion into the schema, e.g. `z.coerce.number()`). Schema-backed field types follow the schema's `InferOutput` exactly.
- Field validators accept only the documented `void` or exact `{ value }` result contracts; explicit migration errors for legacy validator result shapes are removed.
- `CrustStoreError.withCause()` is replaced by the constructor's optional final `cause` argument, `DEFINITION` error details are optional, and the `DefinitionErrorDetails` type export is removed.
- A persisted config file with a non-object JSON root (string, number, array, or `null`) now throws a `PARSE` `CrustStoreError`; previously a string or number root crashed with a raw `TypeError`, while an array or `null` root silently reset the store to defaults.
