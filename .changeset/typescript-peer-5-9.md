---
"@crustjs/core": patch
"@crustjs/create": patch
"@crustjs/effect": patch
"@crustjs/env": patch
"@crustjs/extensions": patch
"@crustjs/man": patch
"@crustjs/mcp": patch
"@crustjs/openapi": patch
"@crustjs/progress": patch
"@crustjs/prompts": patch
"@crustjs/skills": patch
"@crustjs/store": patch
"@crustjs/style": patch
"@crustjs/testing": patch
"@crustjs/tui": patch
---

The optional `typescript` peer dependency now accepts TypeScript 5.9 and later (`>=5.9.0`) instead of only 7.x, so `npm install` no longer fails with `ERESOLVE` in projects on TypeScript 5.9 or 6. Before TypeScript 7, a one-character emoji `short` flag is rejected, and on 5.9 a `@crustjs/store` field's `validate` callback needs an explicit parameter type.
