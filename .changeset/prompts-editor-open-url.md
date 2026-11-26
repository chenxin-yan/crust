---
"@crustjs/prompts": minor
"@crustjs/utils": minor
---

`@crustjs/prompts` adds two helpers:

- `editor({ initial, filename }, io?)` opens `$VISUAL`, else `$EDITOR`, on a temporary file holding `initial`, resolves with the file's text when the editor exits, and removes the file. `filename` must be a file name, not a path. It rejects with `NonInteractiveError` where no prompt can ask, rejects when no editor is set or the editor fails, and stops the editor when the invocation is cancelled.
- `openUrl(url)` opens an `http` or `https` URL with the system launcher, the URL passed as one argument without a shell, and resolves `false` instead of throwing when the URL is refused or no launcher starts. `@crustjs/auth`'s `openBrowser()` now applies its `https`-only rule on top of the same launcher, which lives in `@crustjs/utils/process`.
