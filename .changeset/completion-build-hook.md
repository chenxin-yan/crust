---
"@crustjs/extensions": minor
---

`completion()` contributes a build hook: `crust build` writes `<outdir>/completions/<bin>`, `_<bin>`, and `<bin>.fish`, and `crust build --package` stages the directory in the root npm package. Export `renderBashCompletion()`, `renderZshCompletion()`, `renderFishCompletion()`, and `CompletionRenderOptions` for custom pipelines. `binName` applies to both the runtime command and the build hook. All paths use the root command's version unless explicitly overridden, and require a version to be present.
