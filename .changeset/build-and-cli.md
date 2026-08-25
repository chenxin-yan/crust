---
"@crustjs/core": minor
"@crustjs/crust": minor
"@crustjs/man": minor
"@crustjs/skills": minor
"create-crust": minor
"@crustjs/create": patch
---

Unify build-time artifact generation behind Extension build hooks and a single snapshot protocol.

- Extensions can expose a `build(ctx)` hook for build-time artifact generation. The context carries the frozen root Command Snapshot and a resolved absolute output directory; snapshots are refreshed between hooks so later generators see sections derived from earlier hooks' outputs.
- `crust build` runs build hooks from every registered Extension in registration order. Extension presence is the source of intent — the `--man` flag is removed, and `--no-validate` is the single opt-out that skips entry preparation and all build hooks. npm package staging includes every top-level artifact directory emitted by hooks; the name `bin` is reserved for generated npm executables.
- Build validation and artifact generation share one subprocess-only snapshot-file protocol. `@crustjs/core/tooling` exports `SNAPSHOT_PATH_ENV` (replacing `VALIDATION_MODE_ENV` and `VALIDATION_FORCE_EXIT_ENV`), and man-page generation no longer requires the entry module to export its app. Entries that never call `await app.execute()` previously passed validation vacuously; they now fail with an actionable missing-snapshot error (use `--no-validate` if intentional).
- New `man(options?)` in `@crustjs/man` is a build-only Extension that writes an mdoc page under the build output's `man` directory. Section 1 is the default; `man({ section })` selects another section and `man({ name })` sets the installed command name. `writeManPage()` remains for custom pipelines and accepts a prepared Command Snapshot as `root` instead of a live app.
- The `skill()` Extension in `@crustjs/skills` contributes a build hook that writes packaged skills under the build output's `skills` directory: it copies an available packaged source wholesale and otherwise renders from the prepared Command Snapshot.
- Add first-class Bun, Deno, and Node build runtimes. Projects can persist `crust.runtime` in package.json or override it with `--runtime`; Deno produces standalone executables and Node produces executable bundled JavaScript.
- `--target` accepts canonical Bun target names only. Replace short names such as `linux-x64` and `darwin-arm64` with `bun-linux-x64-baseline` and `bun-darwin-arm64`.
- Make build option validation deterministic through a reusable build plan and consistently reject malformed project package manifests. Fix create-crust workspace version inputs, declaratively validate distribution choices, and avoid announcing overwrites before confirmation.
- Run Windows `.cmd` and `.bat` subprocess shims through the platform shell so Crust builds and create package install and Git steps work with Node's CVE-2024-27980 hardening.
