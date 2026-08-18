---
"@crustjs/core": minor
"@crustjs/create": minor
"create-crust": minor
"@crustjs/extensions": minor
"@crustjs/man": minor
"@crustjs/progress": minor
"@crustjs/prompts": minor
"@crustjs/skills": minor
"@crustjs/store": minor
"@crustjs/style": minor
"@crustjs/testing": minor
---

Migrate package builds to tsdown (Rolldown), declare Node.js 22 or newer (core uses `Promise.withResolvers`, a Node 22+ API), and mark package modules as side-effect free. Internal `@crustjs/utils` imports are inlined so published packages no longer depend on its TypeScript source exports. In particular, this fixes `@crustjs/store` installs that previously required `@crustjs/utils` at runtime. Consumers bundling with Bun 1.3.10–1.3.13 may still encounter oven-sh/bun#27709 when tree-shaking packages with `sideEffects: false`.
