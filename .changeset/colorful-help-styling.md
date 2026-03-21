---
"@crustjs/plugins": patch
---

Add colorful styling and defaults to help output

- Style help output with ANSI colors for usage, sections, and tokens using `@crustjs/style`
- Show default values for flags in help text
- Display boolean negation flags (--no-<name>) for boolean options
- Improve visual hierarchy with color-coded sections (usage in green, commands/options in cyan, required args in yellow)
