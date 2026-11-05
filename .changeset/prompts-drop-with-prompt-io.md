---
"@crustjs/prompts": minor
---

Breaking: prompts use the shared terminal IO names.

- `PromptIO`, `PromptInput`, and `PromptOutput` are renamed to `TerminalIO`, `TerminalInput`, and `TerminalOutput`, the same types `@crustjs/progress` exports.
- The `withPromptIO()` alias is removed; use `withTerminalIO()`, which it pointed to.
- `resolvePromptIO()` is no longer exported; `runPrompt()` applies the same explicit, ambient, then process stream order.
