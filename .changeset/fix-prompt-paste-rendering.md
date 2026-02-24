---
"@crustjs/prompts": patch
---

Fix rendering corruption when pasting long text into prompts by accounting for physical terminal line wrapping and debouncing renders during rapid input
