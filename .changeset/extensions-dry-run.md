---
"@crustjs/extensions": minor
---

Add `dryRun()`, an Extension that provides `dryRunContext`, a `dryRun` Context owning a recursive `--dry-run` flag (`true` when passed). Commands opt in with `.use(dryRunContext)` and branch on `await ctx.dryRun`. Passing `--dry-run` to a command that does not use the Context fails with the exported `DryRunUnsupportedError`, naming the command, before its action runs, so a command that cannot preview never runs for real.
