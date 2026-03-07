---
"@crustjs/skills": minor
---

Add canonical `.crust/skills` store with configurable symlink/copy install strategy.

- Skill bundles are now rendered once to a canonical store (`.crust/skills/` for project scope, `~/.crust/skills/` for global scope) and then installed into agent-specific paths via symlink or copy.
- Add `installMode` option (`"auto"` | `"symlink"` | `"copy"`) to `GenerateOptions` and `SkillPluginOptions`. Default `"auto"` creates symlinks with fallback to copy; `"symlink"` requires symlinks or fails; `"copy"` writes full copies.
- Add `resolveCanonicalSkillPath()` export for resolving the canonical store path.
- Uninstall now cleans up the canonical store when no agent install paths remain.
- Export new `SkillInstallMode` type from package root.
