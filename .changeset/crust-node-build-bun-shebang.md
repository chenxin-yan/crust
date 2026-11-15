---
"@crustjs/crust": patch
---

Node builds (runtime packages and Node binaries) of an entry that starts with `#!/usr/bin/env bun`, the shebang `create-crust` scaffolds for Bun, now produce Node code. Bun used to treat the entry as Bun code despite the Node target, so the built CLI crashed at startup with `ReferenceError: __require is not defined` when it checked `import.meta.main`. `crust build` also warns when an entry's shebang names a different runtime than `crust.runtime`, since a linked command (`npm link`) still starts the runtime the shebang names.

**Behavior change:** `crust build` now fails when a `crust.include` directory contains a `.gitignore`, `.npmignore`, or `.npmrc` (in any letter case, as npm matches them), which npm never publishes. They used to be staged and work locally, then silently disappear from the published package. The error lists each file; rename it (for example `_gitignore`) and restore the name when your CLI copies it, as `scaffold()` from `@crustjs/create` does.
