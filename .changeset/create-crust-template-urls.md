---
"create-crust": patch
---

`create-crust` locates its bundled templates relative to its own module. This fixes missing-template errors when launched through `npx`, `bun x`, or a wrapper that imports the CLI.
