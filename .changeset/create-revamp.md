---
"@crustjs/create": minor
"create-crust": minor
---

Make the scaffolder runtime-portable and fix overwrite handling.

- The scaffolder runs on Bun, Deno, and Node: post-scaffold commands use Node-compatible process APIs, and `create-crust` can be launched with npm, pnpm, Bun, or Deno.
- Fix `--overwrite`: a confirmed overwrite is passed through to the scaffolder, so scaffolding into an existing non-empty destination works instead of aborting. Scaffolding into a non-empty current directory (`create-crust .`) asks for confirmation (pre-answered by `--overwrite`/`--no-overwrite`) instead of failing.
- Scaffolded projects depend on TypeScript 7 (`^7.0.2`), the Go-native compiler; `tsc --noEmit` and all generated scripts work unchanged.
- The unused `isGitInstalled` API is removed from `@crustjs/create`.
