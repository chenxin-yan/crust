# @crustjs/prompts

## 0.0.2

### Patch Changes

- f76fd1c: Extract duplicated UI symbol constants into shared `core/symbols.ts` module and unify `CURSOR_INDICATOR` naming across prompts
- 89f3828: Fix race condition in keypress handling that caused pasted text to lose all but the last character

## 0.0.1

### Patch Changes

- 974f38c: Add `@crustjs/prompts` — interactive terminal prompts for the Crust CLI ecosystem.

  Includes seven prompt types: `input`, `password`, `confirm`, `select`, `multiselect`, `filter`, and `spinner`. Features a customizable three-layer theme system (default, global, per-prompt), fuzzy matching for filter prompts, and a low-level `runPrompt` API for building custom prompts.

  All prompt UI renders to stderr. Every prompt accepts an `initial` option to skip interactivity in CI or scripted environments. Only one prompt can be active at a time — concurrent calls are rejected with a clear error. Shared text-editing logic (`handleTextEdit`) is extracted for reuse in custom prompts.

- Updated dependencies [6d666b3]
  - @crustjs/style@0.0.3
