---
"@crustjs/extensions": minor
---

`help()`, `version()`, and `noColor()` now behave the same in any `.extend()` order. `--help --version` prints help and `--version --help` prints the version, `deploy --preview --help` shows help even when another Extension handles `--preview`, and `--no-color` or `--color` applies to help output whether or not `noColor()` was registered first.
