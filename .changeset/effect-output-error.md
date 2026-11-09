---
"@crustjs/effect": minor
---

`fromCrustError()` and `tryCrust()` map Core's new `OUTPUT` errors (a result rejected by a command's `.output()` schema) to the new `CrustOutputError` tagged class, part of `CrustTaggedError`.
