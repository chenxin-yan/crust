---
"@crustjs/core": minor
---

Extension behavior no longer depends on `.extend()` order. An invocation runs `setup → handle → preRun → validation → action → postRun`:

- `.setup()` configures the process before anything prints and registers cleanup with `ctx.defer()`.
- `.handle(flag, run, { eager })` lets an Extension take over the invocation when the user passes one of its flags. Eager handlers win first, then the flag given first on the command line, as in Click, argparse, and GNU tools.
- `.noAction()` runs when the command has no Command Action and no handler took over; an application can have one.
- `preRun` runs only when the Command Action will, so checks and notices there never fire on `--help` or `--version`. It can fail the invocation by throwing.

**Breaking:** `ctx.handled()` and the `Handled` type are removed; use `.handle()`. Help and snapshots list Extension flags by name instead of registration order.
