---
"@crustjs/store": patch
---

Fix two `@crustjs/store` bugs around the validator contract.

**1. `field({ default: undefined })` is now honored.**

The implementation previously checked both `"default" in opts` **and**
`opts.default !== undefined`, silently dropping an explicitly-passed
`undefined` default and falling back to schema extraction. This
contradicted both the inline comment ("we never use `=== undefined` as a
sentinel") and the `D extends InferOutput<S>` overload contract, which
allows `D = undefined` for optional schemas. The `!== undefined` clause
has been removed; `"default" in opts` is now the sole sentinel for
"caller explicitly set a default".

```ts
// Now correctly honored:
field(z.string().optional().default("fallback"), { default: undefined });
// → default: undefined  (not "fallback")
```

**2. `FieldDef.validate` fail-fast guard no longer misclassifies as `VALIDATION`.**

The migration guard that throws `TypeError` when a validator returns a
value (legacy `{ ok, issues }` shape) previously ran *inside* the same
`try/catch` block that captures legitimate validation rejections —
silently re-wrapping the programming error as
`CrustStoreError("VALIDATION")`. Consumers branching on `err.code ===
"VALIDATION"` could not distinguish a caller bug from a bad config value.

The guard now runs **outside** the `try` block, so:

- Buggy validators returning a value surface as `TypeError` (programming
  error, propagates up).
- User code that legitimately throws `TypeError` from inside their
  validator is still collected as a regular validation issue, unchanged.
