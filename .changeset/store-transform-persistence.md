---
"@crustjs/store": minor
---

Schema-driven transforms in `field()` now persist on `write`, `update`,
and `patch`. On `read`, the schema still validates the persisted value
but its transform output is discarded — the returned value matches what
is on disk.

- `field(z.string().transform(s => s.trim()))` now writes the **trimmed**
  value to disk on `store.write({ name: "  hi  " })`. Same for `update`
  and `patch`.
- A write-time **read-stability guard** rejects transforms whose output
  the schema would reject on a subsequent read. For example,
  `field(z.string().transform(s => s.length))` (string in, number out)
  fails with `CrustStoreError("VALIDATION")` tagged
  `read-unstable transform`. Nothing is written.
- Hand-rolled `validate: (v) => { ... }` callbacks that return `void`
  remain validation-only and are unaffected.

### Behavior change (pre-1.0 minor break)

If you use `field(schemaWithTransform)` today, existing on-disk values
**survive unchanged** on the next `read()` — no automatic migration.
The first subsequent `write` / `update` / `patch` canonicalizes the
value through the transform.

Concrete: a store with `field(z.string().transform(s => s.trim()))` that
has `{ name: "  hi  " }` on disk will:

1. `await store.read()` → `{ name: "  hi  " }` (untouched)
2. `await store.write({ name: "  hi  " })` → file becomes `{ name: "hi" }`

### Type contract widening

`FieldDef.validate` widens from `(value: V) => void | Promise<void>` to
`(value: V) => void | Promise<void> | { value: unknown } | Promise<{ value: unknown }>`.
The new shapes are additive — `void`-returning validators are unchanged.
