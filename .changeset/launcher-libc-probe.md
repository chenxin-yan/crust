---
"@crustjs/crust": patch
---

On Linux, the generated npm launcher now detects glibc or musl by reading the C library Node.js itself is linked against, instead of building a diagnostic report on every start, so npm-installed binaries start faster. It falls back to the previous check when that is not possible.
