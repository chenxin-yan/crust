---
"@crustjs/tui": patch
---

Require `@opentui/core` ^0.9.0. OpenTUI 0.9 always uses its native input parser and removes the `experimental_nativeInput` and `stdinParserMaxBufferBytes` renderer options, removes the `h()`/`Box()`/`Text()` composition API, and replaces Markdown's `renderNode` with `renderBlock`; see the [0.9.0 release notes](https://github.com/anomalyco/opentui/releases/tag/v0.9.0). `runTui()` behaves as before.
