---
"@crustjs/tui": patch
---

Reject with AbortError when Ctrl+C arrives with an uppercase base code on non-Latin keyboard layouts, matching OpenTUI exitOnCtrlC.
