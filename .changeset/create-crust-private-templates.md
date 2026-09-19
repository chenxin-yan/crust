---
"create-crust": patch
---

Scaffolded projects are `"private": true`. The project is the build input, not the npm package: `crust publish` ships the staged `.crust/` packages (which are not private), so a stray `npm publish` in the project directory is now refused instead of uploading the source. `npm link` is unaffected.
