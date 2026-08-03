---
"@crustjs/skills": minor
---

Remove the identity `resolveSkillName` export and simplify skill detection, rendering, installation, and reconciliation internals. Bundle `SKILL.md` frontmatter is now parsed with a real YAML parser: frontmatter without a closing `---` fence is rejected (previously partially tolerated), and frontmatter longer than 50 lines now parses correctly.
