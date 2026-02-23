---
"@crustjs/create": patch
---

Simplify `scaffold()` template resolution: remove `importMeta` option, accept `string | URL` for `template`.

- `string` resolves relative to `process.cwd()`
- `URL` must be a `file:` URL (use `new URL("../templates/base", import.meta.url)` for module-relative paths)
- Added validation with clear error messages for missing directories, non-directory paths, and non-`file:` URLs
