---
"@crustjs/skills": minor
---

Before a command runs, an installed CLI now prints one stderr line when an agent's skill link points at another installed copy of the CLI, naming the `skills repair` command that re-points it. The link is still left alone. The line follows `updateNotifier()`'s skip rules: nothing under CI, when `NO_UPDATE_NOTIFIER` is set, or when stderr is not a terminal.
