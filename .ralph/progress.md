# Progress Log

---

## Task: Initialize @crustjs/prompts package with build tooling and project scaffolding

### Completed

- Created `packages/prompts/` directory with full package scaffolding
- Created `package.json` following `@crustjs/style` conventions: ESM, public access, workspace dependency on `@crustjs/style`, devDeps on `@crustjs/config` and `bunup`
- Created `tsconfig.json` extending `@crustjs/config/tsconfig.base.json` with `declaration` and `isolatedDeclarations`
- Created `bunup.config.ts` with ESM format, bun target, dts generation
- Created `src/index.ts` as empty barrel file with section comment header
- Ran `bun install` to link workspace — resolved successfully
- Verified `bun run build --filter=@crustjs/prompts` — builds cleanly
- Verified `bun run check:types` from packages/prompts — no type errors
- Verified `bun run check` from monorepo root — Biome passes on all 110 files

### Files Changed

- `packages/prompts/package.json` (new)
- `packages/prompts/tsconfig.json` (new)
- `packages/prompts/bunup.config.ts` (new)
- `packages/prompts/src/index.ts` (new)
- `bun.lock` (updated by bun install)

### Decisions

- `@crustjs/style` is a runtime `dependency` (not devDependency) since prompts need styling at runtime
- Followed exact `@crustjs/style` pattern for package.json structure, scripts, and config
- Barrel file is currently empty — will be populated as prompt modules are added in subsequent tasks

### Notes for Future Agent

- The package is fully scaffolded and linked in the workspace. `bun run build --filter=@crustjs/prompts` works.
- `@crustjs/style` exports colors (`cyan`, `dim`, `red`, `green`, `bold`, `yellow`), modifiers, and types like `StyleFn`. Use `import { cyan, dim, bold, ... } from "@crustjs/style"` in prompt implementations.
- The dist/ directory currently only has `index.js` (no `.d.ts`) because the barrel is empty. Once types are exported, bunup will generate `.d.ts` automatically.
- Next task should be implementing the theme system (Task 2) as it's a foundation for all prompts.

---

## Task: Implement the theme system with default theme, createTheme(), and per-prompt style override types

### Completed

- Created `packages/prompts/src/types.ts` with all shared type definitions: `PromptTheme`, `PartialPromptTheme`, `Choice<T>`, `ValidateResult`, `ValidateFn<T>`
- Created `packages/prompts/src/theme.ts` with `defaultTheme`, `createTheme()`, and `resolveTheme()` using `@crustjs/style` color functions
- Updated `packages/prompts/src/index.ts` barrel file with organized exports (Types section and Theme section with section dividers)
- Wrote 14 unit tests in `src/theme.test.ts` covering: default theme slot completeness, expected colors, style function behavior, createTheme with no/partial overrides, resolveTheme layering (global + per-prompt + default)
- All 14 tests pass, type-check clean, Biome clean, build produces `index.js` (690B) + `index.d.ts` (4.02KB)
- Full monorepo test suite passes with zero regressions

### Files Changed

- `packages/prompts/src/types.ts` (new)
- `packages/prompts/src/theme.ts` (new)
- `packages/prompts/src/theme.test.ts` (new)
- `packages/prompts/src/index.ts` (updated — added barrel exports)

### Decisions

- `PromptTheme` uses flat interface with `StyleFn` slots (not nested objects) — simpler and sufficient for the prompt elements. The spec mentioned `filter.match` as a nested slot but a flat `filterMatch` avoids unnecessary nesting complexity.
- `PartialPromptTheme` is a simple mapped type (not deeply recursive `DeepPartial`) since `PromptTheme` is flat — all slots are top-level `StyleFn` values, so `Partial` is equivalent to `DeepPartial` here.
- Default theme colors: `cyan` (prefix/cursor/filterMatch), `bold` (message), `dim` (placeholder/hint/unselected), `yellow` (selected), `red` (error), `green` (success), `magenta` (spinner) — inspired by clack/gum aesthetic.
- `createTheme` returns the `defaultTheme` identity when no overrides passed (avoids unnecessary object spread).
- `resolveTheme` uses three-layer spread: `{ ...defaultTheme, ...globalTheme, ...promptTheme }` — later spreads win.

### Notes for Future Agent

- All types needed by future prompts are exported from `types.ts`: `Choice<T>`, `ValidateFn<T>`, `ValidateResult`, `PromptTheme`, `PartialPromptTheme`.
- Theme functions are ready to use: `resolveTheme(globalTheme?, promptTheme?)` is the primary entry point for prompts to get their effective theme.
- The renderer (Task 3) should accept a `PromptTheme` and pass it to render functions. Each prompt's options should include `theme?: PartialPromptTheme`.
- `@crustjs/style` exports used: `bold`, `cyan`, `dim`, `green`, `magenta`, `red`, `yellow` from `"@crustjs/style"`. The `StyleFn` type is `(text: string) => string`.
- The `Choice<T>` type is `string | { label: string; value: T; hint?: string }` — prompts that use choices (select, multiselect, filter) will need a `normalizeChoices` utility to convert strings to `{ label, value }` objects.

---

## Task: Implement the core renderer engine for managing raw mode, keypress handling, and screen repainting

### Completed

- Created `packages/prompts/src/renderer.ts` with the full terminal rendering engine
- Implemented `runPrompt<S, T>(config)` — the core prompt runner that manages raw mode, keypress events, screen repainting, cursor visibility, and cleanup
- Implemented `KeypressEvent` interface for structured keypress objects parsed from `node:readline` events
- Implemented `PromptConfig<S, T>` interface with render/handleKey/initialState/theme/renderSubmitted
- Implemented `HandleKeyResult<S, T>` discriminated type — return updated state or `{ submit: T }` to resolve
- Implemented TTY detection via `assertTTY()` that throws `NonInteractiveError`
- Implemented Ctrl+C handler that calls `process.exit(0)` for clean cancellation
- Implemented screen repainting with ANSI escape codes (cursor up, erase line, cursor down) to clear previous frame before writing new frame
- Implemented cursor visibility management (hide on start, show on cleanup)
- All output written to `process.stderr` so prompt UI doesn't pollute piped stdout
- Cleanup always restores terminal state (raw mode, cursor visibility) even on errors
- Wrote 16 unit tests in `src/renderer.test.ts` covering: TTY assertion, NonInteractiveError, submit resolution, state updates, stderr output, cursor visibility, renderSubmitted callback, async handleKey, error rejection, initial render, raw mode restore, frame erasing, multiline content
- Updated barrel exports in `src/index.ts` with Renderer section
- All 34 tests pass (14 theme + 16 renderer + 4 NonInteractiveError), type-check clean, Biome clean
- Build produces `index.js` (3.77KB) + `index.d.ts` (7.01KB)
- Full monorepo test suite passes with zero regressions

### Files Changed

- `packages/prompts/src/renderer.ts` (new)
- `packages/prompts/src/renderer.test.ts` (new)
- `packages/prompts/src/index.ts` (updated — added renderer exports)

### Decisions

- `assertTTY()` is called inside the Promise constructor so it rejects rather than throwing synchronously — allows callers to handle via `.catch()` or `await`
- The `handleKey` reducer pattern keeps each prompt's logic pure and testable — prompts return either new state or `{ submit: value }`, and the renderer handles all terminal I/O
- `renderSubmitted` is an optional callback for showing a final confirmation line (e.g., green checkmark with selected value) — if omitted, the last render frame stays on screen
- Output goes to `process.stderr` per spec, keeping stdout clean for piped workflows
- Frame clearing uses individual ANSI sequences (cursor up + erase line loop) rather than a batch `eraseLines` helper — simpler and avoids edge cases with the erase direction
- The `isSubmit` type guard discriminates `HandleKeyResult` by checking for the `submit` property on non-null objects
- Tests mock `process.stdin.setRawMode` and `process.stderr.write` since the test runner doesn't have a real TTY — this is the standard approach for testing terminal-interactive code

### Notes for Future Agent

- To implement a prompt, create a `PromptConfig<S, T>` and call `runPrompt(config)`. The config needs:
  - `initialState: S` — your prompt's state shape (e.g., `{ value: string; cursorPos: number; error: string | null }`)
  - `render: (state, theme) => string` — returns the frame to display (may contain newlines)
  - `handleKey: (key, state) => S | { submit: T }` — pure reducer for keypress events
  - `theme: PromptTheme` — use `resolveTheme()` to get the effective theme
  - `renderSubmitted?: (state, value, theme) => string` — optional final frame after submit
- Each prompt should check for `initial` value before calling `runPrompt` — if `initial` is provided, return it immediately without rendering
- The `KeypressEvent` has: `char` (printable character or empty), `name` (key name like "return", "backspace", "up"), `ctrl`, `meta`, `shift` booleans
- For input-style prompts, handle: printable chars (`key.char.length === 1 && !key.ctrl && !key.meta`), backspace, delete, left, right, home, end, return
- For list-style prompts, handle: up/down (and k/j), return for selection
- The renderer automatically handles Ctrl+C (exits with code 0) — prompts don't need to handle it
- Test pattern: mock `isTTY=true`, mock `setRawMode`, mock `stderr.write`, then emit `process.stdin.emit("keypress", char, keyObj)` to simulate user input
