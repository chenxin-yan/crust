---
"@crustjs/store": minor
---

Breaking: tighten store definitions, persistence, and errors.

- `name` is required; pass `name: "config"` to retain the former implicit `config.json` path.
- Schema-backed fields use `{ schema }`; `field()` and `FieldOptions` are removed. Migrate `field(Port, { default: 3000 })` to `{ schema: Port.default(3000) }`. Schemas own validation, transformations, defaults, and optionality: mixing `schema` with `default` or `validate` throws `DEFINITION`. `type` no longer coerces schema inputs; put coercion in the schema (for example, `z.coerce.number()`). Field types follow schema `InferOutput`, including recursively JSON-compatible named interfaces. Schema defaults materialize on `read()`, before `update()` callbacks, and before `patch()` merges.
- Core fields require a primitive `type`; persisted values still mismatching after coercion and non-finite numbers fail with `VALIDATION`.
- Field `validate` functions are typed to return `void` or `{ value }`; transformed values must match the declared type and are checked at runtime. Other return shapes are now ignored instead of throwing `TypeError`. Throw an error to reject a value.
- `write()`, `update()`, and `patch()` return the config they persisted, including schema transforms. They reject values JSON would alter: `NaN`, `Infinity`, `-0`, sparse arrays, and `undefined` object properties.
- `CrustStoreError.withCause()` is replaced by an optional final `cause` constructor argument. `DEFINITION` errors carry no details; `DefinitionErrorDetails` is removed.
- Non-object persisted JSON roots (strings, numbers, arrays, or `null`) fail with `PARSE` instead of crashing or silently resetting to defaults.
- Non-string `dirPath`, `name`, or `appName` inputs from untyped callers produce `TypeError` instead of `CrustStoreError("PATH")`.
