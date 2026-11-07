---
"@crustjs/extensions": minor
---

Add `confirm()`, an Extension that provides the `confirm` Context and its `--yes` flag. A command that calls `.use(confirm)` awaits `(await ctx.confirm)(message)` before a destructive change: `--yes` resolves at once; on a terminal (stdin and stderr) a yes/no prompt defaulting to No asks, and declining throws `Not confirmed: <message> Nothing was changed.`; anywhere else it throws the exported `ConfirmationRequiredError`, `Confirmation required: <message> Pass --yes to confirm.`. Ctrl-C at the prompt cancels the command (exit code 130). `@crustjs/prompts` loads only when a command asks.
