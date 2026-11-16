---
"@crustjs/skills": minor
---

Before a command runs, an installed CLI now prints one stderr line when an agent's skill link points at another installed copy of the CLI, naming the `skills repair` command that re-points it. The link is still left alone. The line follows `updateNotifier()`'s skip rules: nothing under CI, when `NO_UPDATE_NOTIFIER` is set, or when stderr is not a terminal.

A link now counts as linked when it leads to this copy's skill directory through another link, as in the `.claude/skills/<name>` → `.agents/skills/<name>` layout that `npx skills` writes: real paths are compared, so such a link gets no notice and `skills repair` and `skills install` leave it as it is.
