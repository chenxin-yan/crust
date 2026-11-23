---
"@crustjs/tui": minor
---

`runTui(mount, { signal })` closes the app when `signal` aborts: it destroys the renderer, waits for the terminal to be restored, and rejects with the signal's reason. An already aborted signal rejects before a renderer is created. Pass the action's `signal` so the TUI closes when the invocation is cancelled, for example by `SIGTERM`.
