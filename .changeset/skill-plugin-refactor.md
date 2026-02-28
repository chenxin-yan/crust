---
"@crustjs/skills": patch
---

Refactor skill plugin: remove `autoInstall`, keep auto-update, polish UI.

- Remove `autoInstall` option — the plugin now only auto-updates already-installed skills. First-time installation should be done via the interactive `skill` subcommand or programmatically using the exported primitives (`detectInstalledAgents`, `skillStatus`, `generateSkill`).
- Move auto-update logic from middleware to setup phase, making it independent of plugin registration order.
- Add scope-aware agent detection: `detectInstalledAgents()` now respects the configured scope (`global` or `project`) with fallback from project to global roots.
- Accept options object in `detectInstalledAgents()` with backwards-compatible string parameter support.
- Skip auto-update during build validation mode (`CRUST_INTERNAL_VALIDATE_ONLY`).
- Use spinner from `@crustjs/prompts` for auto-update messages instead of raw `console.log`.
- Style interactive command output with `@crustjs/style` (`bold`, `dim`, `yellow`).
- Replace hardcoded defaults with `DEFAULT_SKILL_COMMAND_NAME` and `DEFAULT_SKILL_SCOPE` constants.
- Move `@crustjs/prompts` and `@crustjs/style` from peer to direct dependencies.
- Fix incorrect `skillPlugin()` JSDoc example that placed `plugins` inside `defineCommand()` instead of `runMain()`.
