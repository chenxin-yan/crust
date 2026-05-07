# @crustjs/prompts

## 0.1.0

### Minor Changes

- 67f815a: # Standard Schema support on `input()` / `password()` validate slot

  The `validate` option on `input()` and `password()` is now polymorphic. In addition to the existing function shape — `(value: string) => true | string | Promise<true | string>` — you can pass any [Standard Schema v1](https://standardschema.dev/) object directly (Zod 4, Valibot, Effect Schema's `Schema.standardSchemaV1(...)`, ArkType, …).

  When a schema is supplied, the prompt:

  1. Parses the raw input on submit by `await`ing `schema['~standard'].validate(submitValue)` (so async schemas like Zod's `refine(async ...)` are supported).
  2. Renders the **first** issue's `message` inline on rejection, falling back to `"Validation failed"` when the issue message is empty.
  3. Resolves to the schema's **transformed output** type on success — no second-pass parse step.
  4. Routes `initial` and (for `input()`) non-TTY `default` through the schema as well, so the `Promise<Output>` type contract holds across every short-circuit path. A short-circuit value the schema rejects throws an `Error`.

  ```ts
  import { input } from "@crustjs/prompts";
  import { z } from "zod";

  const port = await input({
    message: "Port?",
    validate: z.coerce.number().int().min(1),
  });
  //    ^? number
  ```

  This is a fully additive change for function-validator consumers: existing function-shape `validate` calls see no behavior change. `InputOptions` and `PasswordOptions` pick up an extra type parameter (`InputOptions<Output = string>`) which defaults to `string` and is inferred from the shape of `validate` via function overloads.

  The package gains `@standard-schema/spec` as a regular dependency for the spec types only; the runtime discriminator that branches on the `~standard` property is local code. No schema library is bundled — `zod` is a devDependency for tests only.

### Patch Changes

- Updated dependencies [075490b]
- Updated dependencies [075490b]
- Updated dependencies [82f5ad6]
  - @crustjs/style@0.2.0
  - @crustjs/progress@0.0.4

## 0.0.13

### Patch Changes

- 7ca5e5f: Add a dedicated `multifilter()` prompt for fuzzy multi-selection and keep `filter()` focused on single-value search selection by removing the overlapping `multiple: true` mode.

  Clean up the prompt docs, examples, demo script, and public exports so the list-style APIs are presented consistently as `select` / `multiselect` and `filter` / `multifilter`.

- Updated dependencies [df08a3a]
- Updated dependencies [df08a3a]
- Updated dependencies [67a9f25]
  - @crustjs/style@0.1.0
  - @crustjs/progress@0.0.3

## 0.0.12

### Patch Changes

- 23fae62: add multiple option to filter prompt

## 0.0.11

### Patch Changes

- 341f3b1: Add a new `@crustjs/progress` package and move the canonical `spinner()` implementation there.

  `@crustjs/prompts` now temporarily re-exports `spinner` and related types as deprecated compatibility exports, with removal planned for `v0.1.0`.

  Update internal consumers and docs to use `@crustjs/progress` as the new home for spinner-based progress UI.

- Updated dependencies [341f3b1]
  - @crustjs/progress@0.0.2

## 0.0.10

### Patch Changes

- Updated dependencies [9b57c50]
  - @crustjs/style@0.0.6

## 0.0.9

### Patch Changes

- 6dea64c: Handle Ctrl+C prompt cancellations more gracefully. Prompt rendering now moves to a fresh line on cancel, and `Crust.execute()` treats `CancelledError` as a silent user abort with exit code `130` instead of printing `Error: Prompt was cancelled.`.
- 819bad7: Support non-interactive environments in `spinner`. When stderr is not a TTY (CI, piped output), the spinner skips all animation and ANSI escape codes — only the final success (`✓`) or error (`✗`) line is printed. `updateMessage()` calls silently update the message used in the final line.
- Updated dependencies [944f852]
  - @crustjs/style@0.0.5

## 0.0.8

### Patch Changes

- f704195: Return `default` value in non-TTY environments instead of throwing `NonInteractiveError`. Add `isTTY()` utility. Add `default` option to `filter` prompt.

## 0.0.7

### Patch Changes

- 81608ea: Add `SpinnerController` with `updateMessage()` for changing the spinner message mid-task. The task callback now receives a controller object, enabling multi-step progress feedback. Success/error indicators display the latest message. Fully backward compatible — existing tasks that ignore the controller work unchanged.

## 0.0.6

### Patch Changes

- a1f233e: Enable minification for all package builds, reducing bundle sizes by ~27%. Also shorten error messages in `@crustjs/core` for smaller output.
- b17db37: Improve input prompt UX: `default` value is now shown as placeholder text when `placeholder` is not explicitly set, reducing API redundancy. When both are provided, `placeholder` is used visually and the default hint `(value)` still appears.

  Updated `create-crust` to collect all prompts before executing file operations, preventing partial scaffolding on mid-prompt cancellation. The project directory prompt now uses `default: "my-cli"` so users can press Enter to accept it.

- Updated dependencies [a1f233e]
  - @crustjs/style@0.0.4

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
