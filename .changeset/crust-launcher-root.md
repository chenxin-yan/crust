---
"@crustjs/crust": minor
"@crustjs/core": minor
---

A binary started by the root npm package's launcher reads its artifacts from that package: `artifactPath()` returns `<root package>/<name>` there, as it does for a runtime package. A skill link a binary release installs is now `node_modules/my-cli/skills/<name>` on every platform, where it was `node_modules/my-cli-linux-x64/bin/skills/<name>`. A binary started on its own, from a platform package installed directly or a release archive, still reads next to itself.

The launcher passes its package through the `CRUST_INTERNAL_LAUNCHER` environment variable (`LAUNCHER_ENV` in `@crustjs/core/tooling`), which names the binary it starts, so another program that inherits it ignores it.
