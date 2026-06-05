---
"@crustjs/utils": patch
"@crustjs/store": patch
---

Stop forcing `@standard-schema/spec` onto consumers that only use the dependency-free utilities.

`@crustjs/utils` declared `@standard-schema/spec` as a hard `dependency`, but it is only referenced by the `@crustjs/utils/schema` subpath. Consumers that use only the type primitives or `resolveSourceDir` (`@crustjs/core`, `@crustjs/create`, `@crustjs/skills`) were forced to install `@standard-schema/spec` they never reference — a ~72% install-size increase on `@crustjs/core`.

- **`@crustjs/utils`** — `@standard-schema/spec` moves from `dependencies` to an optional `peerDependency`. `@crustjs/utils` now propagates no runtime dependencies. Consumers of the `@crustjs/utils/schema` subpath must provide `@standard-schema/spec` themselves (it is a types-only, zero-runtime package, so an optional peer is sufficient).
- **`@crustjs/store`** — adds `@standard-schema/spec` as a direct dependency, since it consumes the Standard Schema type aliases re-exported from `@crustjs/utils/schema`. `@crustjs/validate` already declared it directly. No public API change to either package.
