---
"@crustjs/crust": patch
---

`crust build` reads a default target list from `crust.targets` in `package.json`, so a CLI that ships a fixed subset of platforms (for example glibc-only Linux because a native dependency has no musl build) runs a bare `crust build` instead of repeating `--target` flags. Accepts the same values as `--target`, which still overrides it per run; rejected for the Node runtime.
