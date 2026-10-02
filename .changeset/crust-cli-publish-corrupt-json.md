---
"@crustjs/crust": patch
---

`crust publish` now names a corrupt staged `manifest.json` or `package.json` and asks you to run `crust build` again, instead of printing a bare JSON `SyntaxError`.
