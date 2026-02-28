---
"@crustjs/skills": patch
---

Polish skill plugin UI output and fix hardcoded defaults.

- Use spinner from `@crustjs/prompts` for auto-sync install/update messages instead of raw `console.log`.
- Style interactive command output with `@crustjs/style` (`bold`, `dim`, `yellow`).
- Fix hardcoded `"skill"` in manage command hint to respect custom `command` option.
- Replace hardcoded `"skill"` and `"global"` with `DEFAULT_SKILL_COMMAND_NAME` and `DEFAULT_SKILL_SCOPE` constants.
- Move `@crustjs/prompts` and `@crustjs/style` from peer to direct dependencies.
