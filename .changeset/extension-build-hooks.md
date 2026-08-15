---
"@crustjs/core": minor
---

Extensions can expose a `build(ctx)` hook for build-time artifact generation. The context carries the frozen root Command Snapshot and a resolved absolute output directory; build tooling such as `crust build` invokes the hook for every registered Extension.
