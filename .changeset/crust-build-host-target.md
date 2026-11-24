---
"@crustjs/crust": minor
---

`crust build` stages binaries for this machine only, unless `crust.targets` or `--target` says otherwise, so a local build no longer compiles every platform. `--target all` stages every target of the compiler. `crust publish` refuses binaries that miss a release target, every target in `crust.targets` (except `host`, the machine that built the stage) or every target of the compiler without it, with `Stage is incomplete` and the missing targets.

**Behavior change:** a binary app without `crust.targets` that ran `crust build && crust publish` now fails at `crust publish`. Build the release with `crust build --target all && crust publish`, or list the platforms you release in `crust.targets`:

```json
{ "crust": { "artifact": "binary", "targets": ["bun-linux-x64", "bun-darwin-arm64", "bun-windows-x64"] } }
```
