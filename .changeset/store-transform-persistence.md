---
"@crustjs/store": minor
---

Schema-driven transforms in `field()` now persist on `write`, `update`,
and `patch`. Reads return the on-disk value verbatim (no transform on
read). Closes the long-standing command/store asymmetry — the store path
now mirrors the command path's "parse and use `result.value`" semantics
for the Standard Schema flow.

### What changed

- `field(z.string().transform(s => s.trim()))` now writes the **trimmed**
  value to disk on `store.write({ name: "  hi  " })` instead of the
  original input. Same applies to `update` and `patch`.
- A new write-time **read-stability guard** rejects transforms whose
  output the schema itself would reject on a subsequent read. For
  example, `field(z.string().transform(s => s.length))` (string in,
  number out) is rejected with `CrustStoreError("VALIDATION")` and an
  issue message tagged `read-unstable transform`. Nothing is written to
  disk when a transform is read-unstable.
- `read()` never transforms. Reads return the on-disk JSON verbatim.
  Schema validation still runs on read and rejects invalid persisted
  config (unchanged).
- Hand-rolled `validate: (v) => { ... }` callbacks that return `void`
  are unaffected — they remain validation-only.

### Behavior change (pre-1.0 minor break)

If you use `field(schemaWithTransform)` today, existing on-disk values
**survive unchanged** on the next `read()` — no automatic migration.
The first subsequent `write` / `update` / `patch` canonicalizes the
value through the transform and persists the new shape.

Concrete: a store with `field(z.string().transform(s => s.trim()))` that
has `{ name: "  hi  " }` on disk will:

1. `await store.read()` → `{ name: "  hi  " }` (untouched)
2. `await store.write({ name: "  hi  " })` → file becomes `{ name: "hi" }`

### Type contract widening

`FieldDef.validate` widens from `(value: V) => void | Promise<void>` to
`(value: V) => void | Promise<void> | { value: V } | Promise<{ value: V }>`.
Plain-literal users who write `validate: (v) => { if (...) throw }`
returning `void` are unaffected — the new shapes are additive.

### No surface contraction

No public types removed. No new exports. `field()`, `createStore`,
`FieldOptions`, and the `Store<TConfig>` interface are all unchanged.
