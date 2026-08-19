---
"@crustjs/extensions": minor
---

Enable update-notifier persistence by default using a lazily loaded `@crustjs/store` cache at `stateDir(packageName)` (scoped names are sanitized, e.g. `@scope/cli` → `scope-cli`). Set `cache: false` to opt out, pass `cache: { intervalMs }` to tune the built-in cache, or continue providing a custom adapter. A corrupt cache file is treated as empty and repaired on the next successful check. `UpdateNotifierState` is now exported. `@crustjs/extensions` gains a runtime dependency on `@crustjs/store`.
