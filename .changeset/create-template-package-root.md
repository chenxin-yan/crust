---
"@crustjs/create": patch
"create-crust": patch
---

Update scaffold template path resolution to be package-root based for better generator DX.

- In `@crustjs/create`, relative string `template` paths now resolve from the nearest package root discovered from `process.argv[1]` (instead of `process.cwd()`).
- Absolute string paths are treated as-is, and `file:` URL templates remain supported.
- Added coverage for package-root resolution and explicit error cases when no package root can be found.
- Updated `create-crust` to use `template: "templates/base"`, aligned with package-root template resolution.
