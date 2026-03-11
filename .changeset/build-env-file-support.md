---
"@crustjs/crust": patch
---

Add `--env-file` flag to `crust build` for loading environment files at build time. Public env vars (PUBLIC_*) are automatically inlined as build-time constants.
