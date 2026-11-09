---
"@crustjs/crust": patch
---

Node builds (runtime packages and Node binaries) of an entry that starts with `#!/usr/bin/env bun`, the shebang `create-crust` scaffolds for Bun, now produce Node code. Bun used to treat the entry as Bun code despite the Node target, so the built CLI crashed at startup with `ReferenceError: __require is not defined` when it checked `import.meta.main`.

**Behavior change:** `crust build` now fails when a `crust.include` directory contains names npm never publishes, such as `.gitignore`, `.npmignore`, `.npmrc`, `.git`, or `.DS_Store`. They used to be staged and work locally, then silently disappear from the published package. The error lists each file; rename it (for example `_gitignore`) and restore the name when your CLI copies it, as `scaffold()` from `@crustjs/create` does.
