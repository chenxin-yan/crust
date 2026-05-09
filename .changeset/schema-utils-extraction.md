---
"@crustjs/schema-utils": minor
"@crustjs/validate": minor
---

# `@crustjs/schema-utils` 0.0.1 — initial release; `@crustjs/validate` extraction

Stands up `@crustjs/schema-utils`, a new published workspace package containing
the **vendor-aware Standard Schema introspection layer** that previously lived
inside `@crustjs/validate`. Both `@crustjs/validate` and (in a follow-up)
`@crustjs/store` now consume a single source of truth for schema introspection
without circular coupling.

## `@crustjs/schema-utils` (new, `0.0.1`)

Initial pre-stability release. Surface unstable until `0.1.0`. Exports four
helper groups plus the shared Standard Schema type aliases:

- **Introspection** — `inferOptions(schema, kind, label)`,
  `extractDefault(schema)`, `InferredOptions`, `ExtractedDefault`.
  Vendor-aware dispatch on `~standard.vendor` (Zod and Effect today; other
  vendors fall through to `{}`).
- **Boundary assertions** — `isStandardSchema`, `assertStandardSchema`.
- **Issue normalization** — `normalizeStandardIssues`,
  `normalizeStandardPath`, `formatPath`, `ValidationIssue`.
- **Type aliases** — `StandardSchema`, `InferInput`, `InferOutput`.

## `@crustjs/validate` (no observable API change)

The locked TP-014 root export surface (`arg`, `flag`, `commandValidator`,
`field`, `parseValue`, `validateStandard`, `validateStandardSync`,
`isStandardSchema`, plus the type re-exports) is **unchanged**. The
introspection logic now physically lives in `@crustjs/schema-utils` and is
re-exported transparently. Consumers do not need to update any imports.

One new transitive dependency (`@crustjs/schema-utils`) is added. No behavior
changes — every call site continues to receive identical inferred metadata,
identical default extraction, and identical thrown error shapes
(`CrustError("DEFINITION")`).
