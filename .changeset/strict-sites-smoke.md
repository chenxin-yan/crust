---
"@crustjs/core": patch
"@crustjs/create": patch
"create-crust": patch
"@crustjs/effect": patch
"@crustjs/env": patch
"@crustjs/extensions": patch
"@crustjs/man": patch
"@crustjs/mcp": patch
"@crustjs/progress": patch
"@crustjs/prompts": patch
"@crustjs/skills": patch
"@crustjs/store": patch
"@crustjs/style": patch
"@crustjs/testing": patch
"@crustjs/utils": patch
---

Raise the minimum supported Node.js version to 24. Remove the Node 22 disposal-stack fallback and use native AsyncDisposableStack on all supported runtimes. Update generated Node projects to require Node 24 and use @types/node 24.
