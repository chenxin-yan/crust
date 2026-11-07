---
"@crustjs/extensions": minor
---

Add `confirmation()`, an Extension that guards commands marked `destructive`. It adds a recursive `--yes` flag; without it, a destructive command asks for confirmation with a `@crustjs/prompts` `confirm()` prompt (defaulting to no) when stdin and stderr are TTYs, and fails with exit code 1 when declined. Without a TTY it fails with the exported `ConfirmationRequiredError`, whose message names the command and `--yes`, instead of running or exiting 0. `@crustjs/extensions` now depends on `@crustjs/prompts`, loaded only when a destructive command needs confirmation.
