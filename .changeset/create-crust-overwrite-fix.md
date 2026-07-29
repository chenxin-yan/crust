---
"create-crust": patch
---

Fix `--overwrite`: a confirmed overwrite is now passed through to the scaffolder, so scaffolding into an existing non-empty destination works instead of aborting. Scaffolding into a non-empty current directory (`create-crust .`) now asks for confirmation (pre-answered by `--overwrite`/`--no-overwrite`) instead of failing.
