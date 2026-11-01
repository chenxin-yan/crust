---
"@crustjs/tui": patch
---

Require `@opentui/core` ^0.8.0. OpenTUI 0.7 and 0.8 change APIs for custom renderables and ScrollBox parts and remove the `nativeSceneWorkBudget` renderer option; see the [0.7.0](https://github.com/anomalyco/opentui/releases/tag/v0.7.0) and [0.8.0](https://github.com/anomalyco/opentui/releases/tag/v0.8.0) release notes. `runTui()` behaves as before.
