---
"@crustjs/prompts": patch
---

`process.exit()` while a prompt is active restores the cursor and raw mode.

The fake terminal behind `createPromptIO()` and `renderPrompt()` (`@crustjs/prompts/testing`) now wraps text at its 80 columns by display width, so `screen()` matches a real terminal for long lines and wide characters.

Text longer than 80 columns is now split across rows in `screen()` (and in `@crustjs/testing`'s `runInteractive()` screen), so assertions that match across the wrap point need to join the rows first.
