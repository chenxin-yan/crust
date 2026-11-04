---
"@crustjs/prompts": patch
"@crustjs/progress": patch
---

Decide default theme colors from the stream a prompt or spinner writes to instead of stdout. Prompts and spinners on a terminal stderr are now colored when stdout is piped, and redirected stderr no longer receives ANSI escapes when stdout is a terminal. `NO_COLOR` and `FORCE_COLOR` apply as before; theme functions you pass are unchanged.
