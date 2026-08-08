---
"@crustjs/store": minor
---

Standardize schema-backed fields on the plain definition shape `{ schema }` and remove the `field()` factory.

This is a breaking API change. Migrate `field(Port, { default: 3000 })` to `{ schema: Port.default(3000) }`. Standard Schemas now exclusively own validation, transformation, defaults, and optionality; `default` and `validate` cannot be mixed with `schema`. Schema-backed field types now follow the schema's `InferOutput` exactly.

`type` metadata on a schema-backed field no longer coerces persisted strings before validation — the schema owns coercion. If you relied on `field(schema, { type: "number" })` coercing `"3000"` to `3000`, move the coercion into the schema (e.g. `z.coerce.number()`).
