---
"@crustjs/core": minor
"@crustjs/create": minor
"create-crust": minor
"@crustjs/crust": minor
"@crustjs/extensions": minor
"@crustjs/man": minor
"@crustjs/progress": minor
"@crustjs/prompts": minor
"@crustjs/skills": minor
"@crustjs/store": minor
"@crustjs/style": minor
"@crustjs/testing": minor
---

Modernize the runtime support matrix and package builds.

- Supported runtimes: Bun 1.3.14+, Node.js 22+, and Deno 2.8+. Package runtime code is portable across all three — Bun globals are replaced with Node-compatible built-ins, and process spawning uses `node:child_process`. On runtimes without `AsyncDisposableStack` (Node 22/23), invocations fall back to an in-package disposal stack.
- Package builds migrate to tsdown (Rolldown) and modules are marked side-effect free. Internal `@crustjs/utils` imports are inlined, fixing `@crustjs/store` installs that previously required `@crustjs/utils` at runtime. Consumers bundling with Bun 1.3.10–1.3.13 may encounter oven-sh/bun#27709 when tree-shaking packages with `sideEffects: false`.
- All packages that ship type declarations declare an optional `typescript: "^7.0.0"` peerDependency. Builder inference performance is measured and supported against the native TypeScript 7 compiler; plain-JavaScript consumers are unaffected.
