---
"@crustjs/create": minor
"create-crust": minor
---

- `create-crust` can be launched with npm, pnpm, Bun, or Deno (`npm create crust`, `bunx create-crust`, `deno run -A npm:create-crust`). It ships a single minimal template with binary/runtime distribution choices; the modular template, template-selection prompt, and `--template` flag are removed.
- Confirmed overwrites now reach the scaffolder instead of aborting. `create-crust .` in a non-empty directory asks before writing; `--overwrite`/`--no-overwrite` pre-answer the confirmation.
- Scaffolded projects depend on TypeScript 7 (`^7.0.2`); generated `tsc --noEmit` scripts are unchanged.
- `@crustjs/create` runs post-scaffold `command` steps through the platform shell (`/bin/sh` or `cmd.exe`) instead of Bun Shell. Windows `.cmd`/`.bat` install and Git shims work under Node's CVE-2024-27980 hardening.
- The `getGitUser` and `isGitInstalled` exports are removed from `@crustjs/create`; callers needing them must query Git themselves.
