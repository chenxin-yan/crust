---
"@crustjs/crust": minor
---

Add the programmatic `build()` API: `import { build } from "@crustjs/crust"` runs the `crust build` pipeline (same options as the flags: `cwd`, `targets`, `envFiles`, `minify`, `validate`, plus `onLog`) and returns the staged `stageDir`, generated `artifacts`, and per-command Extension `reports`. It is silent unless `onLog` is given and throws on failure; `crust build` is now a thin wrapper over it. The published package ships the library as a bundled `dist/` with declarations, and `crust build` now carries a project's `exports`, `peerDependencies`, and `peerDependenciesMeta` fields into the staged root package (`exports` targets validated against the staged files and Node's target rules, peer ranges must be publishable as written; projects without these fields are unchanged). `@crustjs/crust` declares `@crustjs/core` as a peer dependency so the re-exported `BuildReport` is core's own type. The Command Snapshot subprocess uses `bun` from `PATH` like compilation does, so `build()` also works under Node when Bun is installed.

Carried CommonJS `.js`/`.d.ts` exports require an included nested package scope, or explicit `.cjs`/`.d.cts` extensions, to avoid changing their module format under the generated ESM root. Unresolved `workspace:` and `catalog:` peer ranges are rejected because staged manifests are published without rewriting.
