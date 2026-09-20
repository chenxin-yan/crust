---
"@crustjs/core": patch
---

Finished Bun and Node CLI bundles (built by `crust build`) no longer include the `CRUST_INTERNAL_SNAPSHOT_PATH` snapshot/build-hook protocol: the bundle is smaller and dispatches normally even when that variable is set. Source entries run by `crust build` and Deno binaries are unchanged.
