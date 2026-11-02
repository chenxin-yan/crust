---
"@crustjs/crust": minor
"create-crust": minor
"@crustjs/utils": minor
"@crustjs/core": patch
"@crustjs/mcp": patch
---

Drop Deno support. Crust now targets Bun and Node.js only.

- `@crustjs/crust`: `crust.runtime: "deno"` and Deno targets are removed; `deno.json`/`deno.jsonc` no longer selects a runtime. `--minify` now defaults to `true` in `--help`.
- `create-crust`: `--runtime deno` is no longer accepted.
- `@crustjs/utils`: `PACKAGED_BUILD_KEY` and `isPackagedBuild` are removed from `@crustjs/utils/artifacts`, and Deno compiled executables are no longer detected.
- `@crustjs/core`: the snapshot protocol no longer checks the packaged-build marker.
- `@crustjs/mcp`: Deno standalone builds are no longer detected as compiled executables.
