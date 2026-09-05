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
---

Update runtime compatibility and package builds.

- Libraries support Bun 1.3.14+, Node.js 22+, and Deno 2.8+ (`engines` updated). Context disposal includes a fallback for runtimes without `AsyncDisposableStack`, including Node 22/23. The `crust` build CLI remains Bun tooling; its npm distribution ships standalone executables with Bun embedded.
- Published packages no longer depend on `@crustjs/utils`; its helpers are bundled. `@crustjs/store` also drops `@standard-schema/spec`. Library packages and `create-crust` are marked `sideEffects: false` for bundlers.
- Packages shipping declarations declare an optional TypeScript `^7.0.0` peer; builder inference is supported on TypeScript 7. JavaScript consumers are unaffected by this compiler requirement.
