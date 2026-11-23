---
"create-crust": patch
---

A scaffolded binary app's README says that `build` stages only this machine's target and that a release needs `crust build --target all` or `crust.targets`. Its `.gitignore` also ignores `.crust.lock`, where `crust build` stages the next build.
