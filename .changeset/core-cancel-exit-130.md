---
"@crustjs/core": patch
---

`execute()` keeps exit code `130` when cleanup fails after cancellation (Ctrl-C or an aborted `execute({ signal })`), so shell loops and scripts still see the interrupt. A `SuppressedError` whose `suppressed` side is an `AbortError` now counts as cancellation. Core still renders the cleanup failure (`Cleanup failed: …` for Context disposal, or the disposal error from an action's own `await using`) and stays silent about the abort itself. Previously these runs exited `1`.
