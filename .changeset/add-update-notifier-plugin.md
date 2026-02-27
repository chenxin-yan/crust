---
"@crustjs/plugins": patch
"@crustjs/crust": patch
"create-crust": patch
---

Add `updateNotifierPlugin` to `@crustjs/plugins`. The plugin checks the npm registry for newer versions of your package and displays a non-blocking update notice after command execution. Features daily caching, configurable check intervals, soft-failure on network errors, and notification deduplication. Adopted in the `crust` CLI and the `create-crust` scaffold template by default.
