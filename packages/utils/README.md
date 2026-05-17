# `@crustjs/utils`

Shared low-level utilities for the Crust ecosystem.

> **Status: pre-stable (`0.0.1`).** Public surface may change without notice
> until `0.1.0`. Pin to an exact version if depending externally:
> `bun add @crustjs/utils@0.0.1`.

## Audience

Internal de-duplication primitives for the `@crustjs/*` packages
(`@crustjs/create`, `@crustjs/skills`, …). Plugin authors may use these at
their own risk — no stability promises are made until the package graduates
to `0.1.0`.

## Install

```sh
bun add @crustjs/utils
```

## Exports

### `resolveSourceDir(input: string | URL): string`

Resolves an absolute filesystem path from a caller-supplied source directory
descriptor. Three input modes are supported:

| Input                  | Behavior                                                                                                 |
| ---------------------- | -------------------------------------------------------------------------------------------------------- |
| `file:` URL            | Resolved via `url.fileURLToPath()`. Non-`file:` protocols throw.                                         |
| Absolute string path   | Returned as `path.resolve(input)`.                                                                       |
| Relative string path   | Resolved against the nearest `package.json` directory walking up from `process.argv[1]`.                 |

Throws a descriptive `Error` when:

- A `URL` uses a non-`file:` protocol (message names the offending protocol).
- A relative string path is given but `process.argv[1]` is unset.
- A relative string path is given but no `package.json` is found walking up
  from `process.argv[1]`.

#### Examples

```ts
import { resolveSourceDir } from "@crustjs/utils";

// 1. file: URL — relative to the calling module
const a = resolveSourceDir(new URL("../templates/base", import.meta.url));

// 2. Absolute path
const b = resolveSourceDir("/abs/path/to/templates/base");

// 3. Relative path — resolved from the consuming package's root
const c = resolveSourceDir("templates/base");
```

## Internal subpath: `@crustjs/utils/schema`

> **Internal — do not import.** Standard Schema introspection helpers
> consumed by `@crustjs/validate` and `@crustjs/store`. Not part of the
> public Crust API; may change in any release without a deprecation cycle.
> Use `@crustjs/validate` instead.

Published under this subpath only so the `dependencies` of
`@crustjs/validate` (and `@crustjs/store`) resolve for external consumers.
The subpath consumes `@crustjs/core` (declared as an optional
`peerDependency` on `@crustjs/utils` — callers of `resolveSourceDir` alone
do not need it).

## License

MIT
