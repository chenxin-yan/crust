---
"@crustjs/testing": patch
---

`runInteractive()` exposes the action's `stdout()` output through a new `stdout()` method on the returned handle, joined with newlines like `RunOutcome.stdout`. `done` is unchanged.
