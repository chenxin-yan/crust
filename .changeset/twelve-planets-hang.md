---
"@crustjs/crust": patch
"create-crust": patch
---

Add per-platform npm distribution workflow with `crust build --distribute` and `crust publish` commands. The build command now supports `--distribute` and `--stage-dir` flags to stage per-OS/arch npm packages with platform-specific binaries and shell/cmd resolvers. The new `publish` command publishes staged packages in dependency order. Updated `create-crust` binary distribution template to use the new distribute/publish workflow.
