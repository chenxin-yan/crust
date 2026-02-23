# @crustjs/create

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
