---
"@crustjs/prompts": patch
---

Make `message` optional for input, password, confirm, select, multiselect, and filter prompts. When omitted, prompts render cleanly on a single line without orphaned prefixes or "undefined" in output.
