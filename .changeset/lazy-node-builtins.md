---
"@crustjs/core": patch
"@crustjs/extensions": patch
"@crustjs/utils": patch
---

Start faster on Node. Core, Extensions, and utils load Node built-ins with `process.getBuiltinModule()` where they are used instead of static `node:*` imports, which made Node evaluate every lazy export of `node:fs` and `node:util` at startup. `node:stream`, which is expensive to load on Bun, now loads only for `run()` and for `execute()` with injected `io`.
