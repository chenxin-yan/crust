---
"@crustjs/crust": patch
---

`crust build` gains a repeatable `--bun-plugin <specifier>` flag that loads Bun bundler plugins from your project (default export) for Bun standalone and Node builds — for example `crust build --bun-plugin @opentui/solid/bun-plugin` compiles OpenTUI Solid apps. Deno builds reject the flag.

Compiled executables no longer load the `bunfig.toml` of the directory they start in (`--no-compile-autoload-bunfig`), so a project `preload` such as `@opentui/solid/preload` can no longer crash your binary — or `crust` itself — before your code runs. `.env` autoloading is unchanged.

Without a separate `bun` on `PATH`, `crust build` on arm64 hosts refuses a build whose targets include the host's own target (e.g. `bun-darwin-arm64` on Apple silicon): Bun would compile it by copying the running `crust` executable onto itself and emit a binary that crashes on start. The error names the other targets so you can rerun with explicit `--target`; install Bun to build the host target. On x64 hosts the same target is compiled through Bun's `-baseline` alias, which Bun downloads clean, so it builds without Bun installed.
