---
"@crustjs/skills": patch
---

Normalize universal agent messaging in `skill` command output.

- Auto-update messages now report universal targets as `Universal` instead of enumerating each supported universal agent.
- Install and overwrite success output now prints a single `Universal -> <path>` entry for universal installs.
- Remove output now reports `Removed from Universal` (and combines with additional agents when applicable).
