---
"@crustjs/crust": minor
---

`crust build` now always stages the publishable npm tree in `.crust/` (wiped at the start of every staged build): `manifest.json`, `root/` with `bin/<command>.js`, one `<platform>/` package per target for Bun and Deno, and `artifacts/` where Extension build hooks write. The root launcher runs in place (`node .crust/root/bin/<command>.js`), so the same tree serves local runs and `crust publish`, which reads `.crust/manifest.json` and fails with `Run crust build before crust publish` when it is missing.

Removed: `--package`, `--stage-dir` (build and publish), `--outdir`, `--name`, `--resolver`, and the raw multi-binary `dist/` tree with `cli`/`cli.cmd` shell resolvers. `--outfile` remains as the escape hatch for one exact file: the single `--target`, or this machine's target when omitted; more than one `--target` with `--outfile` is an error. Platform binaries are named `<unscoped package name>-<target>`; the command name is the single `bin` entry's key, or the unscoped package name.
