---
"@crustjs/crust": minor
---

`crust build` type-checks the project first: it runs the project's own `tsc --noEmit` on the `tsconfig.json` in the project root, after the configuration is checked and before anything is compiled or staged. A type error fails the build with `tsc`'s output and keeps the previous `.crust/`. `--no-typecheck` (or `typecheck: false` for `build()`) skips the check.

`typescript` (`>=5.9.0`) is now a required peer dependency of `@crustjs/crust`.

**Breaking:** a project with type errors, without `typescript` installed, or without a `tsconfig.json` in its root no longer builds. Fix the errors, install `typescript` and add a `tsconfig.json`, or pass `--no-typecheck`. A project that needs other `tsc` flags, such as `--runExternalCode` for `@crustjs/openapi`'s content mapper, runs its own `tsc` and builds with `--no-typecheck`.
