---
"@crustjs/crust": minor
---

Add first-class Bun, Deno, and Node build runtimes to `crust build`. Projects can persist `crust.runtime` in package.json or override it with `--runtime`; Deno produces standalone executables and Node produces executable bundled JavaScript.

`--target` now accepts canonical Bun target names only: replace short names such as `linux-x64` and `darwin-arm64` with `bun-linux-x64-baseline` and `bun-darwin-arm64`.
