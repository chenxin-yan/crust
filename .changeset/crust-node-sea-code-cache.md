---
"@crustjs/crust": patch
---

`crust build` now embeds a V8 code cache in Node.js binaries when the `node` on `PATH` is the exact official binary a target embeds (the host's own target, built without `NODE_OPTIONS`), so each command starts without compiling its JavaScript first: 1 to 2 ms less for a 30-command CLI on Linux x64. Other targets and other builds of Node.js get no cache, since V8 would reject it with a warning at every start.
