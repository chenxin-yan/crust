# @crustjs/prompts

## 0.0.5

### Patch Changes

- 695854e: Update prompt prefix symbols for a cleaner aesthetic: active prefix `▸` → `┃`, submitted prefix `✔` → `✓`, and add shared `PREFIX_ERROR` (`✗`). Spinner now uses shared symbol constants instead of hardcoded values.

## 0.0.4

### Patch Changes

- 967d2bf: Change active prompt prefix from ○ to ▸ to avoid visual confusion with confirm's unselected radio button
- e44d1c6: Add sensible default messages when `message` is omitted: input ("Enter a value"), password ("Enter a password"), confirm ("Are you sure?"), select ("Pick an option"), multiselect ("Pick one or more"), filter ("Search and select")
- 21298c8: Make `message` optional for input, password, confirm, select, multiselect, and filter prompts. When omitted, prompts render cleanly on a single line without orphaned prefixes or "undefined" in output.

## 0.0.3

### Patch Changes

- 1b77051: Fix rendering corruption when pasting long text into prompts by accounting for physical terminal line wrapping and debouncing renders during rapid input

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
