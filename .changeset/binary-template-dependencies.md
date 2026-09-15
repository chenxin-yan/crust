---
"create-crust": patch
---

Binary projects now list `@crustjs/core` and `@crustjs/extensions` under `dependencies` instead of `devDependencies`, matching runtime projects. Only `@crustjs/crust` stays in `devDependencies`. `crust build --package` generates the published `package.json` files from your npm metadata, so the split has no effect on what ships. The `publish` script also drops the redundant `--stage-dir dist/npm` (the default).
