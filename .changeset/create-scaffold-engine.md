---
"@crustjs/create": patch
"create-crust": patch
---

Add `@crustjs/create` — a headless, zero-dependency scaffolding engine for building `create-xxx` tools.

Provides `scaffold()` for template copying with `{{var}}` interpolation and dotfile renaming, `runSteps()` for declarative post-scaffold automation (install deps, git init, open editor, custom commands), and utilities for package manager detection and git user info.

Refactor `create-crust` to use `@crustjs/create` as its scaffolding backend, replacing the inline implementation with the shared library (dogfooding).
