# @crustjs/utils

Internal shared utilities for Crust workspace packages.

- `@crustjs/utils/error` — Node error type guards.
- `@crustjs/utils/json` — JSON value types and object guards.
- `@crustjs/utils/primitive` — shared primitive types and coercion helpers.
- `@crustjs/utils/process` — executable lookup and subprocess execution.
- `@crustjs/utils/source` — source directory resolution.
- `@crustjs/utils/schema` — Standard Schema types and issue normalization.
- `@crustjs/utils/terminal` — cross-package ambient terminal IO.

Utils are inline-bundled into consumers by tsdown's `onlyImport` rule and must remain a devDependency of those packages. Stateful modules share state through a `Symbol.for` process-global key; `terminal.ts` uses that slot as the cross-bundle share point, covered by `scripts/smoke-runtimes/smoke.mjs`.
