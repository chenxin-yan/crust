---
"@crustjs/prompts": minor
---

Prompt fixes:

- Keys typed ahead in the same chunk as the submitting Enter are kept for the next prompt on the same input, so a pasted `one⏎two⏎` answers two prompts instead of one. A Ctrl+C or Ctrl+D typed after that Enter cancels the next prompt, not the one that just submitted.
- After the terminal is resized, the next redraw counts the frame's rows at the new width instead of leaving stale rows. The fake terminal of `createPromptIO()` (`@crustjs/prompts/testing`) rewraps its screen on `resize()`, as most terminal emulators do, so a test sees the same redraw.
- Ctrl+D cancels a prompt like Ctrl+C, rejecting with an `AbortError`.
- A cancelled prompt (Ctrl+C, Ctrl+D, or an aborted `signal`) replaces its frame with a cancelled line, such as `✗ Project name?`. Custom prompts draw theirs with the new optional `renderCancelled` of `runPrompt()`; `PREFIX_CANCELLED` (`✗`) is exported.
- `multiselect()` and `multifilter()` check `required`, `min`, and `max` on an `initial` value and on the `default` they return without a terminal, rejecting like `input()` does, for example `default value rejected: Select at least 2 items`.
- A `default` or `initial` outside literal `choices` of `select()`, `multiselect()`, `filter()`, or `multifilter()` is reported on that option, naming the allowed values (`Type '"bogus"' is not assignable to type '"eslint" | "prettier"'`), instead of as a mismatch of `choices`.
