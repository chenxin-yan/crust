---
"@crustjs/extensions": minor
"@crustjs/utils": minor
"@crustjs/mcp": minor
---

`--json` handles more of what a command returns or fails with.

- An object property holding `undefined` is left out, as `JSON.stringify` leaves it out, instead of failing with "the command result is not JSON data". An optional field such as `z.string().optional()` no longer breaks `--json` depending on the data. MCP tool results and `nextSteps` json values follow the same rule, through `parseJsonValue()` in `@crustjs/utils/json`.
- A value that is not JSON data is reported with where it sits: `--json: the command result is not JSON data (items[3].createdAt: Not a plain object).`
- An argv syntax error, such as an unknown flag or a flag missing its value, is written to stderr as JSON when `--json` is its own word before any `--`, with Core's `details` (the flag's name and the reason). It printed Core's `Error:` line before. The exit code stays 2.
- The `help` command of `help({ command: true })`, `completion <shell>`, and `@crustjs/mcp`'s `mcp config` return the text they print, so `--json` prints it once as a JSON string, where stdout used to be empty.
