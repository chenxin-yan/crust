---
"@crustjs/prompts": patch
---

`input()` and `password()` now run `validate` on `initial` values; `input()` also validates non-interactive `default` values, throwing `initial value rejected: …` / `default value rejected: …` like the `schema` path already did.

Prompts render only when both their input and their output are TTYs. With a redirected output (for example `mycli 2> log.txt`, or `app.run()` without injected terminal IO) they return `default` or reject with `NonInteractiveError` instead of drawing into the stream and waiting for keys. Custom outputs must set `isTTY: true` to render prompts.

`select()`, `multiselect()`, `filter()`, and `multifilter()` reject a `default` or `initial` outside literal `choices` at compile time instead of widening the result type. Dynamic choice arrays and explicit type arguments are unchanged.

Also fixes:

- Multiselect `a` (toggle all) clears the selection when `max` is reached.
- Tab and other control characters are no longer inserted into text input, password, and filter queries. Ctrl+J submits like Enter: `runPrompt()` reports it as `return`.
- Fuzzy match highlighting lands on the right characters when lowercasing changes a label's length (for example `İ`).
- `input()` with a `schema` shows the submitted text instead of `String(output)` (such as `[object Object]`).
