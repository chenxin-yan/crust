---
"@crustjs/crust": minor
---

`crust build` now precompiles Bun binaries to bytecode (`bun build --compile --bytecode`), so they start without parsing their JavaScript: a 30-command CLI starts in ~12 ms instead of ~22 ms, for ~2% more binary size. Pass `--no-bytecode` (or `bytecode: false` to `build()`) to opt out. `--bytecode` is rejected for runtime packages and Node.js binaries, which cannot use Bun bytecode.
