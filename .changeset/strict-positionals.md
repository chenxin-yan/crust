---
"@crustjs/core": patch
---

Reject undeclared positional arguments instead of silently discarding them. Commands that intentionally accept loose positionals can opt out with `allowExcessPositionals`.
