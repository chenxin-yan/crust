---
"create-crust": patch
---

A scaffolded binary app lists every target of its runtime in `crust.targets`, the platforms a release ships, and its README says to remove those you do not ship. The `release` script is `crust build && crust publish`, so it publishes a fresh build. The `.gitignore` also ignores `.crust.lock`, where `crust build` stages the next build.
