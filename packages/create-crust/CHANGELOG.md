# create-crust

## 0.0.10

### Patch Changes

- 3d8b529: fix missing files field in package.json

## 0.0.9

### Patch Changes

- Updated dependencies [1b77051]
  - @crustjs/prompts@0.0.3

## 0.0.8

### Patch Changes

- Updated dependencies [f76fd1c]
- Updated dependencies [89f3828]
  - @crustjs/prompts@0.0.2

## 0.0.7

### Patch Changes

- da09867: Revamp scaffolding CLI: use `@crustjs/core` for command definition, `@crustjs/prompts` for interactive prompts, dynamic dependency installation via detected package manager, git-init confirmation prompt, and support scaffolding into the current directory with `.`.
- b415f81: **BREAKING:** Remove re-exports from `@crustjs/crust` — it is now a CLI-only package.

  `@crustjs/crust` no longer re-exports APIs from `@crustjs/core` and `@crustjs/plugins`. It now provides only the `crust` CLI binary (e.g., `crust build`) and should be installed as a dev dependency. Import framework APIs directly from `@crustjs/core` and `@crustjs/plugins` instead.

  Migration: replace `import { defineCommand, runMain, helpPlugin } from "@crustjs/crust"` with `import { defineCommand, runMain } from "@crustjs/core"` and `import { helpPlugin } from "@crustjs/plugins"`. Move `@crustjs/crust` to `devDependencies` and add `@crustjs/core` + `@crustjs/plugins` to `dependencies`.

- Updated dependencies [6e5d21d]
  - @crustjs/create@0.0.2

## 0.0.6

### Patch Changes

- 5110c83: Add `@crustjs/create` — a headless, zero-dependency scaffolding engine for building `create-xxx` tools.

  Provides `scaffold()` for template copying with `{{var}}` interpolation and dotfile renaming, `runSteps()` for declarative post-scaffold automation (install deps, git init, open editor, custom commands), and utilities for package manager detection and git user info.

  Refactor `create-crust` to use `@crustjs/create` as its scaffolding backend, replacing the inline implementation with the shared library (dogfooding).

- Updated dependencies [5110c83]
  - @crustjs/create@0.0.1

## 0.0.5

### Patch Changes

- 8e0b48a: Fix published package metadata containing unresolved workspace and catalog protocols by switching to bun publish

## 0.0.4

### Patch Changes

- dcc258c: switch to use literal string for flags and args types

## 0.0.3

### Patch Changes

- Update domain to crustjs.com, update dependencies, add homepage, and remove flaky cross-compilation tests
