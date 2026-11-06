---
"@crustjs/skills": minor
---

Automatic skill link repair now runs only before a Command Action, never for `--help`, `--version`, or other flags an Extension handles, whatever the `.extend()` order.
