---
"@crustjs/core": patch
"@crustjs/create": patch
"@crustjs/extensions": patch
"@crustjs/man": patch
"@crustjs/progress": patch
"@crustjs/prompts": patch
"@crustjs/skills": patch
"@crustjs/store": patch
"@crustjs/style": patch
"@crustjs/testing": patch
---

Declare an optional `typescript: "^7.0.0"` peerDependency on all packages that ship type declarations. The builder's inference performance is measured and supported against the native TypeScript 7 compiler (the same one `create-crust` scaffolds with); plain-JavaScript consumers are unaffected (`peerDependenciesMeta.optional`).
