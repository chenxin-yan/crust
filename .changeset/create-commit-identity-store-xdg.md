---
"@crustjs/create": patch
"@crustjs/store": patch
---

The `git-init` step no longer writes a fallback `Crust <crust@scaffolded.project>` identity into the new repository's config. When `user.name` or `user.email` is not configured, the missing field is passed to the initial commit only, so later commits use the user's own identity. `configDir()`, `dataDir()`, `stateDir()`, and `cacheDir()` now ignore relative `XDG_*_HOME` values, as the XDG Base Directory spec requires, and fall back to the home-relative default.
