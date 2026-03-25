---
"@crustjs/skills": patch
---

Suppress the universal skills agent hint when the skill command runs non-interactively.

This keeps `skill` output focused on actual changes and avoids showing the universal agent support list during no-op runs that default to the current installed selection.
