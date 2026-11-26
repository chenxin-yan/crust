---
"@crustjs/crust": minor
---

A binary release ships exactly the targets `crust.targets` lists, and build targets are always target names. `crust build` stages the targets `--target` names, else those in `crust.targets`, else this machine's target only, so a local build without `crust.targets` no longer compiles every platform. `crust publish` of binaries requires `crust.targets`, and fails with `Stage is incomplete`, naming the missing targets, when the stage lacks one of them. A staged target that `crust.targets` does not list fails with `Stage is stale`. The JSON schema for the `crust` block lists the target names.

**Breaking:** list the platforms you release in `crust.targets`, by name; `crust publish` of binaries fails without it:

```json
{ "crust": { "artifact": "binary", "targets": ["bun-linux-x64", "bun-darwin-arm64", "bun-windows-x64"] } }
```

`host` is no longer a target, in `--target` or `crust.targets`: replace `--target host` with this machine's target name, such as `--target bun-linux-x64`, or omit `--target` in a project without `crust.targets`.
