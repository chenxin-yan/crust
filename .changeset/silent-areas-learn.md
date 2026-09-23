---
"@crustjs/crust": minor
---

Add the programmatic `build()` API: `import { build } from "@crustjs/crust"` runs the `crust build` pipeline (same options as the flags: `cwd`, `targets`, `envFiles`, `minify`, `validate`, plus `onLog`) and returns the staged `stageDir`, generated `artifacts`, and per-command Extension `reports`. It is silent unless `onLog` is given and throws on failure; `crust build` is now a thin wrapper over it. The published package ships the library as a bundled `dist/` with declarations, and `crust build` now carries a project's `exports` field into the staged root package (validated against the staged files; projects without `exports` are unchanged). The Command Snapshot subprocess uses `bun` from `PATH` like compilation does, so `build()` also works under Node when Bun is installed.
