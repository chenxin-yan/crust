---
"@crustjs/crust": patch
---

Clarify `crust build` validation help text and docs: validation materializes the full command tree by default (unchanged behavior); use `--no-validate` for entry modules with unavoidable import-time side effects. Locks the default-on behavior with an integration test.
