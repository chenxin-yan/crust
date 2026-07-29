---
"@crustjs/utils": patch
"@crustjs/core": patch
"@crustjs/store": patch
"@crustjs/create": patch
"@crustjs/skills": patch
---

Move `@crustjs/utils` to granular public subpaths: `@crustjs/utils/primitive`, `@crustjs/utils/source`, and `@crustjs/utils/schema`.

The utils package no longer exposes a root entry point, publishes side-effect-free metadata for downstream bundlers, disables minification for library output, and keeps the Standard Schema helpers as a public low-level subpath. Workspace consumers now import the narrower subpaths directly.
