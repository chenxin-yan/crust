---
"@crustjs/crust": patch
---

Fix shell resolver failing to locate prebuilt binaries when invoked via symlink (e.g. from `node_modules/.bin/`). The resolver now follows symlinks to resolve the real script directory before looking up platform binaries.
