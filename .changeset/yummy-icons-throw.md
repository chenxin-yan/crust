---
"@crustjs/crust": minor
"@crustjs/core": minor
"@crustjs/utils": minor
---

Add experimental Deno runtime packages. With `"crust": { "runtime": "deno", "artifact": "package" }` (or `--artifact package`), `crust build` bundles each command with native `deno bundle`, which Deno marks experimental, into a root-only npm package whose `bin/<command>.js` files run on the consumer's installed Deno through `deno run npm:<package>/<command>` or `deno install -g`. The package embeds no runtime, carries no shebang or permission flags, and leaves every grant to the consumer. Building needs `deno` 2.5.0 or newer on PATH, checked in the project directory before `.crust/` is replaced; the bundler version is printed as `Compiler:` but not recorded as `embeddedRuntimeVersion`, and `engines.deno` stays a consumer requirement. `--minify`, `--env-file`, `crust.bunPlugins`, `--target`, and `crust.targets` are rejected for this mode. Deno binaries and their permissions are unchanged.

Finished Deno packages mark themselves through a Crust-generated bundle entry, so `@crustjs/core` skips Command Snapshot and build-hook execution and `resolveArtifactDir()` from `@crustjs/utils/artifacts` resolves assets beside the installed package, without reading any environment variable. The package must be built against this `@crustjs/core` release or newer: with an older core, the finished package needs `--allow-env` and obeys build-only snapshot variables.
