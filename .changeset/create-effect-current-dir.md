---
"create-crust": patch
---

Treat any path that resolves to the current directory (such as `./`) like `.`, and stop printing doubled prefixes such as `cd ././my-cli` in the next steps.
