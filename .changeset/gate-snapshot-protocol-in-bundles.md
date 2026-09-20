---
"@crustjs/core": patch
---

Finished Bun and Node CLI bundles no longer include the build-time snapshot/build-hook code path. `crust build` marks those bundles with `process.env.CRUST_INTERNAL_BUILD === "1"`, and `.execute()` now compiles the `CRUST_INTERNAL_SNAPSHOT_PATH` protocol out behind that marker, so a finished bundle dispatches normally even when the variable is set and ships a slightly smaller bundle. The source-mode protocol `crust build` uses to prepare snapshots and run Extension build hooks is unchanged, as are Deno binaries.
