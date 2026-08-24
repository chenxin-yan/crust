---
"@crustjs/prompts": minor
---

Trim the custom-prompt utility surface to the prompt engine, text editing, and fuzzy matching APIs. The formatting and list-normalization helpers, `NormalizedChoice`, and `CURSOR_CHAR` are no longer exported.

Fix multifilter selection when duplicate choices share a label and value, and preserve the initial cursor when the first default value is `undefined`.
