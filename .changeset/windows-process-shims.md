---
"@crustjs/crust": patch
"@crustjs/create": patch
---

Run Windows `.cmd` and `.bat` subprocess shims through the platform shell so Crust builds and create package install and Git steps work with Node's CVE-2024-27980 hardening.
