---
"@crustjs/crust": patch
---

Add `crust.external` for Node and Bun runtime packages. Listed packages, such as `"crust": { "external": ["better-sqlite3"] }`, stay out of the bundle and ship as `dependencies` of the staged root package with their ranges from `dependencies`, so npm installs them beside the bundle. Each entry must be a `dependencies` key with a publishable range; `@crustjs/*` packages (including npm aliases of them), binaries, and the Deno runtime are rejected before `.crust/` is replaced.

Staged `peerDependencies` now also reject `file:`, `link:`, and `portal:` ranges, local paths, and local tarballs, which only resolve on the publishing machine, in addition to `workspace:` and `catalog:`.
