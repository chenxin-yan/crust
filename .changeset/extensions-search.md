---
"@crustjs/extensions": minor
---

`search()` adds `search <task...>`, which prints the five visible commands that best match a task described in words, best first, and returns them as `{ command, description?, hasAction }[]` (`SearchMatch`). It declares `.output()`, so with `json()` `--json` prints only the array; no match prints a line and returns `[]` with exit code 0. Group and Extension commands are included, hidden commands are not. A "Find a command" section on the root command points `--help` and `--llms` at it.
