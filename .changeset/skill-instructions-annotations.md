---
"@crustjs/skills": patch
---

Add custom instructions and command annotations support. Plugin-level `instructions` option renders top-level guidance into SKILL.md, and `annotate()` attaches agent-facing instructions to individual commands. Also forwards `license`, `allowedTools`, `compatibility`, and `disableModelInvocation` from plugin options to skill metadata.
