---
"@crustjs/skills": patch
---

Reclassify `pi` as a universal agent. Pi discovers `~/.agents/skills/` and project `.agents/skills/` natively, so the universal link now covers it instead of a Pi-specific link in `~/.pi/agent/skills/` (`.pi/skills/` for project scope). Existing links in the old Pi-specific directories are no longer managed; remove them manually if present.
