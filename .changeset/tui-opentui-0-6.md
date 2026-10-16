---
"@crustjs/tui": patch
---

Require `@opentui/core` ^0.6.6. OpenTUI 0.6 removed some renderer APIs, including the `useThread` option of `CliRendererConfig`; see its [0.6.0 release notes](https://github.com/anomalyco/opentui/releases/tag/v0.6.0).

`runTui()` now resolves after the renderer has restored the terminal, so output written right after it no longer lands on the alternate screen. It rejects with the stream's error when the output fails, and Ctrl+C with a Latin key whose base code is C (such as Ctrl+J on Dvorak) no longer rejects with `AbortError`, matching OpenTUI 0.6.
