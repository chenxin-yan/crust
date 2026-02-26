---
"@crustjs/skills": patch
---

Harden SKILL.md generation with bug fixes and new features:

**Bug fixes:** YAML frontmatter values containing special characters (`:`, `#`, `*`, `!`, etc.) are now properly escaped with double quotes. Markdown table cells in args/flags tables now escape literal `|` characters to prevent broken rendering.

**New features:** Added `isValidSkillName()` export that validates skill names against the Agent Skills spec pattern (`^[a-z0-9]+(-[a-z0-9]+)*$`, 1–64 chars); `generateSkill()` now throws on invalid names. Added optional `allowedTools`, `license`, `compatibility`, and `disableModelInvocation` fields to `SkillMeta`, emitted conditionally in YAML frontmatter.

**Improved output:** SKILL.md now includes "when to use this skill" guidance text derived from the skill description, and uses stronger directive language for lazy-loading command files.
