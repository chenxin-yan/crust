---
"@crustjs/prompts": patch
---

Make `isTTY()` and `assertTTY()` default to the resolved ambient prompt input instead of always reading `process.stdin`. `resolvePromptIO()` is now exported for custom prompt lifecycle checks.
