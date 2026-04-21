---
"@crustjs/prompts": patch
---

Add a dedicated `multifilter()` prompt for fuzzy multi-selection and keep `filter()` focused on single-value search selection by removing the overlapping `multiple: true` mode.

Clean up the prompt docs, examples, demo script, and public exports so the list-style APIs are presented consistently as `select` / `multiselect` and `filter` / `multifilter`.
