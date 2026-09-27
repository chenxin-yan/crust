---
"@crustjs/crust": minor
"@crustjs/utils": minor
"create-crust": minor
---

Breaking: `crust build` and `build()` now require an explicit artifact kind, set with `"crust": { "artifact": "package" | "binary" }` in package.json, `--artifact`, or the `artifact` build option (the option overrides the config). The implicit defaults are gone: to keep the previous output, set `"artifact": "binary"` for bun and deno projects and `"artifact": "package"` for node projects; the error names the old default for the inferred runtime. Runtime inference is unchanged. New Bun runtime packages (`"runtime": "bun", "artifact": "package"`) stage one root-only package whose commands are Bun-targeted bundles behind `#!/usr/bin/env bun`, so installed commands run on the consumer's Bun. Runtime packages reject `--target` and `crust.targets`. Binary builds select the compiler once (external `bun` on PATH first, then the embedded Bun; `deno` on PATH), check its reported version against `engines.bun`/`engines.deno` before replacing `.crust/` (a `--version` probe that does not exit within 30 seconds is killed and fails the build), print it as `Compiler:`, and record it as `embeddedRuntimeVersion` in `manifest.json`, which now also records `runtime` and `artifact`. Crust never installs or upgrades a compiler. create-crust templates set `crust.artifact` to keep each runtime's existing output.
