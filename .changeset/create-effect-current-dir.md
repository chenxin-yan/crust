---
"create-crust": patch
---

Treat any path that resolves to the current directory (such as `./`) like `.`, and stop printing doubled prefixes such as `cd ././my-cli` in the next steps. The generated `.gitignore` no longer labels `node_modules` as Bun-only.
