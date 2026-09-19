# @crustjs/utils

Internal shared utilities for Crust workspace packages.

- `@crustjs/utils/error` — Node error type guards.
- `@crustjs/utils/json` — JSON value types and object guards.
- `@crustjs/utils/path` — path containment checks.
- `@crustjs/utils/primitive` — shared primitive types and coercion helpers.
- `@crustjs/utils/process` — package-manager detection, executable lookup, and subprocess execution.
- `@crustjs/utils/source` — source directory resolution.
- `@crustjs/utils/schema` — Standard Schema types and issue normalization.
- `@crustjs/utils/terminal` — cross-package ambient terminal IO.

`@crustjs/utils` is a published internal support package, not a supported public API. Consumer packages declare it as a runtime dependency so an install shares one copy. Multiple installed copies remain possible, so `terminal.ts` still shares its state through a `Symbol.for` process-global slot; `packages/utils/src/terminal.test.ts` covers that cross-copy sharing, and `scripts/smoke-runtimes/smoke.mjs` covers the cross-package integration on Bun, Node, and Deno.
