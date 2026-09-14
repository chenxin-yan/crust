---
"@crustjs/crust": minor
---

`crust publish` now uploads staged packages with `npm publish` instead of `bun publish`, so it works with npm trusted publishing (OIDC) from CI. `npm` must be on `PATH`.
