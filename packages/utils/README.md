# @crustjs/utils

Shared low-level utilities for the Crust ecosystem.

## `@crustjs/utils/schema`

> **Internal — do not import from application code.** Standard Schema helpers used by Crust packages.

The schema subpath exposes only portable Standard Schema utilities:

- boundary checks (`isStandardSchema`, `assertStandardSchema`)
- issue normalization (`normalizeStandardIssues`, `normalizeStandardPath`, `formatPath`)
- type aliases (`StandardSchema`, `InferInput`, `InferOutput`)

It does not inspect vendor internals, dispatch on `schema["~standard"].vendor`, or extract metadata/defaults from schemas.
