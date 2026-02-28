---
"@crustjs/skills": patch
---

Support non-interactive mode for the `skill` command.

- Detect TTY and conditionally pass `initial` to prompts so the command works in CI/piped environments.
- In non-interactive mode, install skills to all detected agents automatically.
- In non-interactive mode, skip conflict overwrite (safe default).
