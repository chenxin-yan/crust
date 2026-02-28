---
"@crustjs/skills": patch
---

Fix `autoInstall` not working due to middleware ordering and scope detection issues.

- Move auto-install/auto-update logic from middleware to setup phase, making it independent of plugin registration order. Previously, plugins like `helpPlugin()` could short-circuit middleware and prevent `skillPlugin()` from running.
- Add scope-aware agent detection: `detectInstalledAgents()` now respects the configured scope (`global` or `project`) with fallback from project to global roots.
- Accept options object in `detectInstalledAgents()` with backwards-compatible string parameter support.
- Skip auto-install during build validation mode (`CRUST_INTERNAL_VALIDATE_ONLY`).
- Fix incorrect `skillPlugin()` JSDoc example that placed `plugins` inside `defineCommand()` instead of `runMain()`.
- Update README with correct plugin registration, troubleshooting guide, and scope detection docs.
