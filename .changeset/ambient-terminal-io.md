---
"@crustjs/core": patch
"@crustjs/progress": patch
"@crustjs/prompts": patch
---

Route default progress and prompt output through explicitly injected Core invocation IO. Captured progress uses non-TTY final lines, while prompt input remains explicitly stream-based.
