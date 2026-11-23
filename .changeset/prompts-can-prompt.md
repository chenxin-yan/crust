---
"@crustjs/prompts": minor
---

`canPrompt(io?)` reports whether a prompt can ask here, the rule every prompt and the `confirmation()` Extension follow: the resolved input and output are both TTYs, and `CI` is unset unless the input was injected (through `io` or `withTerminalIO()`, as `runInteractive()` does).

- Breaking: `isTTY()` and `assertTTY()` are removed. Use `canPrompt()`; it also checks the output stream.
- Behaviour change: under `CI`, a prompt on the process terminal no longer asks; it returns its `default` or rejects with `NonInteractiveError`, as the `confirmation()` Extension already did, since a CI job can run on a pseudo-terminal nobody answers.
