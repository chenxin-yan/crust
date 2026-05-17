---
"@crustjs/utils": patch
"@crustjs/validate": patch
"@crustjs/store": patch
---

Fold `@crustjs/schema-utils` into `@crustjs/utils` as the internal `/schema` subpath.

`@crustjs/utils` now exposes Standard Schema introspection helpers (`assertStandardSchema`, `isStandardSchema`, `extractDefault`, `inferOptions`, `formatPath`, `normalizeStandardIssues`, `normalizeStandardPath`, plus type aliases) under `@crustjs/utils/schema`. The subpath inherits the same internal-only contract that `@crustjs/schema-utils` had — **not part of the public Crust API** and may change without a deprecation cycle. Use `@crustjs/validate` instead.

`@crustjs/core` is now an optional `peerDependency` of `@crustjs/utils` — callers of `resolveSourceDir` alone do not need it; only consumers of `/schema` (which already depend on `@crustjs/core`) provide it.

`@crustjs/validate` and `@crustjs/store` now depend on `@crustjs/utils` instead of `@crustjs/schema-utils`. No public API change for either package — internal import paths swapped from `@crustjs/schema-utils` to `@crustjs/utils/schema`.

The standalone `@crustjs/schema-utils` workspace package is removed. The published `@crustjs/schema-utils@0.0.1` artifact on npm will be deprecated separately.
