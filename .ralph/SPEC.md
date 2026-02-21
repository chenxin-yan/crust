# @crustjs/prompts

> Interactive terminal prompts for the Crust CLI ecosystem — minimal, zero external dependencies, inspired by charmbracelet/gum.

## Overview

`@crustjs/prompts` provides a set of interactive terminal prompt utilities for building rich CLI experiences within the Crust ecosystem. It offers config-object-style functions for common prompt patterns: text input, confirmation, single/multi selection, fuzzy filtering, password entry, and spinners.

The package targets CLI developers who use `@crustjs/core` to build commands and need interactive user input. It is a **standalone** package — users import and call prompts directly in their command's `run()` handler. No plugin or core integration is required.

The design is inspired by [charmbracelet/gum](https://github.com/charmbracelet/gum), prioritizing simplicity, zero external dependencies (only `@crustjs/style` as a workspace sibling), and a delightful terminal UX with sensible defaults.

## Scope

### Included

- **input** — Single-line text input with placeholder, initial value, and validation
- **password** — Masked text input (variant of input with masking character)
- **confirm** — Yes/no boolean confirmation
- **select** — Arrow-key single selection from a list of choices
- **multiselect** — Checkbox-style multi selection from a list
- **filter** — Fuzzy-search interactive filter over a list of items
- **spinner** — Display a spinner while an async task runs, return its result
- **Global theming** — Default theme with global override + per-prompt style overrides
- **Non-interactive support** — `initial` option skips prompt entirely; throws when not a TTY and no initial provided
- **Built-in validation** — `validate: (value) => true | string` with inline error display and re-prompting
- **Cancellation** — Ctrl+C calls `process.exit(0)`

### Excluded

- File picker / directory browser
- Pager / scrolling viewer
- Text formatting / styling utilities (use `@crustjs/style`)
- Multi-line textarea editor
- Table selection
- Integration as a `@crustjs/core` plugin (standalone only)
- Schema-based validation (deferred to future `@crustjs/validate`)

## Technical Stack

- **Language**: TypeScript 5.x with strict mode (`verbatimModuleSyntax`, `noUncheckedIndexedAccess`)
- **Runtime**: Bun (via bunup build target)
- **Terminal I/O**: `node:readline` + `process.stdin.setRawMode()` for raw keypress handling
- **Styling**: `@crustjs/style` (workspace dependency) for ANSI colors, modifiers, and capability detection
- **Build**: bunup — ESM, `.d.ts` generation
- **Testing**: bun:test, console/stdin mocking
- **Linting**: Biome (tabs, double quotes, auto-imports)

## Architecture

The package is organized as independent prompt modules behind a unified barrel export. Each prompt is a standalone async function that takes a config object and returns a `Promise<T>` with the user's response.

### Core Layers

1. **Prompt functions** (`input`, `confirm`, `select`, `multiselect`, `password`, `filter`, `spinner`) — Public API. Each validates options, checks for `initial` (skip if provided), detects TTY, then delegates to the renderer.

2. **Renderer** — Shared terminal rendering engine that manages raw mode, keypress events, cursor positioning, and screen repainting. Uses `node:readline` for keypress parsing and `process.stdout` for ANSI output. Each prompt provides a render function and a keypress handler to the renderer.

3. **Theme system** — A default theme object defining colors/styles for all prompt elements (cursor, selected item, error message, placeholder, etc.). `createTheme()` merges user overrides. Per-prompt style options override the active theme.

4. **Fuzzy matcher** — Simple built-in algorithm: match query characters in order within candidate strings, score by contiguity and position. Used by the `filter` prompt.

### Key Design Decisions

- **`initial` skips prompt** — If `initial` is set on any prompt, the function returns it immediately without rendering. This enables flag-based prefill: `await input({ message: "Name?", initial: flags.name })`.
- **Non-TTY throws** — If `process.stdin.isTTY` is false and no `initial` is provided, throw a typed error.
- **Ctrl+C exits** — Calls `process.exit(0)` for clean cancellation. No sentinel values or error types for cancellation.
- **Validation loop** — On submit, run `validate(value)`. If it returns a string (error message), display it inline and keep the prompt active. If `true`, resolve.
- **Choice items** — Accept `string[]` or `Array<{ label: string; value: T }>` for select/multiselect/filter. When strings, `label === value`.

## Constraints

- Zero external npm dependencies — only `@crustjs/style` as a workspace sibling
- Must work on macOS, Linux, and Windows terminals
- All public functions return `Promise<T>` — never synchronous blocking
- Must respect terminal capability detection from `@crustjs/style` (degrade gracefully without color support)
- Follow crust monorepo conventions: ESM, no default exports, `.ts` extensions in imports, Biome formatting
- Package published as `@crustjs/prompts` under `@crustjs` org

## References

- [charmbracelet/gum](https://github.com/charmbracelet/gum) — Primary design inspiration
- [@inquirer/prompts](https://github.com/SBoudrias/Inquirer.js) — API pattern reference
- [clack](https://github.com/bombshell-dev/clack) — Minimal prompt library reference
- Node.js [readline](https://nodejs.org/api/readline.html) and [TTY](https://nodejs.org/api/tty.html) APIs
