# @crustjs/utils

Shared low-level utilities for the Crust ecosystem.

> **Pre-stable.** Public surface may change without notice until `0.1.0`.
> Pin to an exact version if depending externally.
>
> This package intentionally has no root export. Import from the granular
> subpaths documented below.

## Install

```sh
bun add @crustjs/utils
```

## `resolveSourceDir`

```ts
import { resolveSourceDir } from "@crustjs/utils/source";

const templateDir = resolveSourceDir(new URL("../templates/base", import.meta.url));
```

Resolves a source directory descriptor to an absolute filesystem path. It is
used by Crust packages that ship templates, skill bundles, or other reference
assets alongside their published package.

Supported inputs:

- `file:` URLs, usually `new URL("./path", import.meta.url)`.
- Absolute string paths.
- Relative string paths, resolved from the nearest `package.json` found by
  walking up from `process.argv[1]`.

Relative paths are anchored to the consumer package root rather than the current
working directory, which makes CLI entrypoints more predictable when invoked
from arbitrary directories.

## Type primitives

```ts
import {
	coerceBooleanString,
	tryCoerceNumber,
	type BaseValueType,
	type ResolvePrimitive,
} from "@crustjs/utils/primitive";
```

`BaseValueType` is the shared primitive type vocabulary used by Crust packages:
`"string" | "number" | "boolean"`. `ResolvePrimitive<T>` maps those literals to
TypeScript primitives (`"number"` → `number`, etc.) and distributes over unions.

`tryCoerceNumber(raw)` returns `undefined` only when `Number(raw)` is `NaN`, so
`tryCoerceNumber("")` returns `0`. `coerceBooleanString(raw)` preserves Crust's
strict boolean string behavior: only `"true"` and `"1"` are truthy.

## `@crustjs/utils/schema`

Low-level Standard Schema helpers shared by Crust packages. This public subpath
is provider-agnostic and intentionally narrow.

The schema subpath exposes only portable Standard Schema utilities:

- boundary checks (`isStandardSchema`, `assertStandardSchema`)
- issue normalization (`normalizeStandardIssues`, `normalizeStandardPath`, `formatPath`)
- type aliases (`StandardSchema`, `InferInput`, `InferOutput`, `ValidationIssue`)

It does not inspect vendor internals, dispatch on `schema["~standard"].vendor`,
or extract metadata/defaults from schemas.

`@standard-schema/spec` is an optional peer dependency, so importing this
subpath requires the consumer to install `@standard-schema/spec` directly. The
rest of `@crustjs/utils` has no runtime dependencies.
