---
"@crustjs/core": patch
"@crustjs/skills": patch
---

Refine skill plugin ergonomics and tighten core public API boundaries.

- `@crustjs/skills`:
  - `skillPlugin` now uses `command?: string` (default: `"skill"`) instead of `boolean | string`.
  - `skillPlugin` option `scope` was replaced with `defaultScope`.
  - Interactive scope selection now prompts for `project`/`global` only when `defaultScope` is not provided; non-interactive fallback is `global`.
  - Auto-update now checks both `project` and `global` install paths for the current cwd and reports scope in update messaging.
  - Added `skill update` subcommand for manual update-only runs.

- `@crustjs/core`:
  - Removed `createCommandNode` and `computeEffectiveFlags` from the root `@crustjs/core` export surface.
  - High-level `Crust` builder usage is now the recommended path for command construction.
