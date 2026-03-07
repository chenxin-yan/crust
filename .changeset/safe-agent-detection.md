---
"@crustjs/skills": patch
---

Replace spawn-based agent detection with non-executing PATH lookup to prevent unrelated IDE CLIs from launching during normal CLI startup.

- Replace `checkCommandAvailable`/`runCommand` (which spawned `<cmd> --version`, `<cmd> -v`, `<cmd> version`) with `isCommandOnPath()` — a pure filesystem PATH scan using `fs.accessSync` with `X_OK`. This eliminates the bare `version` positional arg that caused Electron-based IDEs (Antigravity, Kiro) to open on macOS.
- Remove `detectInstalledAgents()` from `autoUpdateSkills` and `buildSkillUpdateCommand`. Auto-update and `skill update` now check all known agents via `skillStatus()` (filesystem-only), avoiding any PATH probing during normal CLI startup.
- Keep `detectInstalledAgents()` only for the interactive `skill` command UX, now backed by the safe PATH lookup.
