# @crustjs/utils

Internal shared utilities for Crust packages

Not a public API: its subpaths (see `exports` in `package.json`) change together with the Crust packages that use them.

## Terminal

`isCI(env = process.env)` from `@crustjs/utils/terminal` is the CI rule Crust packages share (`confirm()` and `updateNotifier()` in `@crustjs/extensions`). `CI` counts as set unless it is unset, empty, `0`, or `false` in any letter case. Pass `env` to read another environment instead of `process.env`:

```ts
import { isCI } from "@crustjs/utils/terminal";

isCI(); // reads process.env.CI
isCI({ CI: "0" }); // false
```
