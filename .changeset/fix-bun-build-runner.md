---
"@crustjs/crust": patch
---

Prefer spawning real `bun build --compile` over in-process `Bun.build()` to avoid standalone compiler failures on some host/target combinations.

- Add `resolveBunBuildRunner()` to prefer the real Bun binary on PATH, falling back to `process.execPath` with `BUN_BE_BUN=1` only when needed
- Update `execBuild()` to always use subprocess compilation instead of the programmatic API
- Improve error reporting by surfacing both stdout and stderr from failed builds
- Add unit tests for the new runner resolution logic
- Update documentation to reflect the new build behavior
