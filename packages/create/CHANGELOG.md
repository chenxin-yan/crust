# @crustjs/create

## 0.0.3

### Patch Changes

- 55b588b: Update scaffold template path resolution to be package-root based for better generator DX.

  - In `@crustjs/create`, relative string `template` paths now resolve from the nearest package root discovered from `process.argv[1]` (instead of `process.cwd()`).
  - Absolute string paths are treated as-is, and `file:` URL templates remain supported.
  - Added coverage for package-root resolution and explicit error cases when no package root can be found.
  - Updated `create-crust` to use `template: "templates/base"`, aligned with package-root template resolution.

## 0.0.2

### Patch Changes

- 6e5d21d: Simplify `scaffold()` template resolution: remove `importMeta` option, accept `string | URL` for `template`.

  - `string` resolves relative to `process.cwd()`
  - `URL` must be a `file:` URL (use `new URL("../templates/base", import.meta.url)` for module-relative paths)
  - Added validation with clear error messages for missing directories, non-directory paths, and non-`file:` URLs

## 0.0.1

### Patch Changes

- 5110c83: Add `@crustjs/create` — a headless, zero-dependency scaffolding engine for building `create-xxx` tools.

  Provides `scaffold()` for template copying with `{{var}}` interpolation and dotfile renaming, `runSteps()` for declarative post-scaffold automation (install deps, git init, open editor, custom commands), and utilities for package manager detection and git user info.

  Refactor `create-crust` to use `@crustjs/create` as its scaffolding backend, replacing the inline implementation with the shared library (dogfooding).
