---
"@crustjs/core": patch
---

Review-driven follow-ups to TP-012:

- `type: "path"` flag/arg defaults now run through `coercePath` so omitting the flag yields the same absolute path users get when they pass it on the command line (`{ type: "path", default: "./dist" }` previously returned the raw relative string).
- `choices` is now validated against `default` values in both the parse and non-parse default branches, mirroring argv-side enforcement so `{ choices: ["a","b"], default: "z" }` can't be silently accepted while `--flag z` throws.
- Re-export the documented `Resolve<T>` and `ResolveBaseType<F>` type helpers from `@crustjs/core` so consumers can `import type { Resolve, ResolveBaseType } from "@crustjs/core"` as the API reference shows.
