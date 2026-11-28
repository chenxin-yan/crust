---
"@crustjs/core": minor
"@crustjs/mcp": minor
---

The root command's metadata takes the keys packages add through `CommandExtras`, as every other command does: `new Crust("my-cli", { mcp: { readOnlyHint: true } })` compiles once `@crustjs/mcp` is in the project. `RootCommandMeta` is now an interface that extends `CommandExtras`. On the root, `mcp: false` keeps every command out of the tools, and hints become the root tool's annotations. A root key no installed Extension owns is a `DEFINITION` error (`unowned-key`) from source and in `crust build`, as on any command.
