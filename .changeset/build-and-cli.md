---
"@crustjs/crust": minor
"@crustjs/man": minor
---

Extension build hooks, multi-runtime builds, and snapshot-based man pages.

- `crust build` runs registered Extension build hooks in registration order, refreshing the root snapshot between hooks. `--no-validate` skips entry preparation and all hooks. Entries that never reach `await app.execute()` now fail with a missing-snapshot error instead of passing validation vacuously; use `--no-validate` if intentional.
- Choose Bun, Deno, or Node with `--runtime` or package.json's `crust.runtime`. Deno produces standalone executables with all permissions (`-A`); `--package`, `--minify`, and `--env-file` are unsupported. Node produces one executable JavaScript bundle with a Node shebang; `--target` and `--package` are unsupported.
- `--target` requires canonical compiler names. Replace `linux-x64`/`darwin-arm64` with `bun-linux-x64-baseline`/`bun-darwin-arm64`; Deno uses triples such as `aarch64-apple-darwin`. Unknown targets suggest canonical spellings.
- `crust build --package` stages every top-level artifact directory emitted by hooks; `bin` is reserved for npm executables. License copying selects the first existing `LICENSE`, `LICENSE.md`, `LICENCE`, or `LICENCE.md`, including it in root and platform packages.
- Windows `.cmd`/`.bat` subprocess shims run through the platform shell, allowing builds under Node's CVE-2024-27980 hardening.
- `@crustjs/man` adds the build-only `man(options?)` Extension and `ManOptions`. It writes `<outdir>/man/<name>.<section>`; section defaults to 1, with `name`/`section` overrides. For custom pipelines, migrate `writeManPage({ app, ... })` to `writeManPage({ root: await app.snapshot(), ... })`; `argv` and `logWarnings` options are removed. `renderManPageMdoc()` now takes a `CommandSnapshot` as `root` instead of `CommandNode`.
