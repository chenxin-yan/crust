---
"@crustjs/skills": patch
---

Only classify ENOENT as a missing skill entry or non-resolving link target. Propagate permission and other filesystem failures from installation, status, and uninstallation instead of silently reporting missing states.
