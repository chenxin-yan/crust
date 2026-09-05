# @crustjs/prompts

## 0.2.0

### Minor Changes

- [#337](https://github.com/chenxin-yan/crust/pull/337) [`8e9fe39`](https://github.com/chenxin-yan/crust/commit/8e9fe3996832f0e6327bead3e82888d58df6201a) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Complete the custom-prompt rendering kit and simplify its testing API.
  
  - Export the text, match, line, choice-list, and glyph rendering helpers used by built-in prompts.
  - Remove `pressKey()` from `@crustjs/prompts/testing` (breaking). Use the rendered prompt's `keys()` method for named and control keys, or `type()` for literal text.

- [#307](https://github.com/chenxin-yan/crust/pull/307) [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Rework `@crustjs/prompts` around themed instances, injectable IO, and typed results (breaking).
  
  - Global theme state is removed: `setTheme`, `getTheme`, and `createTheme` are gone. `createPrompts({ theme })` returns all prompt functions bound to a theme plus the resolved `theme` for custom `runPrompt` renderers; `runPrompt`'s `theme` config is an optional partial merged onto `defaultTheme`. Resolution order: `defaultTheme` ← instance theme ← per-call `theme`. Migrate `setTheme({...})` → `const p = createPrompts({ theme: {...} })`.
  - Prompt cancellation (Ctrl+C) rejects with a standard `DOMException` named `"AbortError"` instead of the removed `CancelledError` class; check `err.name === "AbortError"`.
  - Prompt IO is injectable through optional `io` parameters and `withPromptIO()`. The new `@crustjs/prompts/testing` subpath ships fake-TTY helpers, whose `keys()` autocompletes named key names (`Key` and `NamedKey` types are exported).
  - `select`, `multiselect`, `filter`, and `multifilter` narrow their result type to the union of literal choice values (`choices: ["dev", "prod"]` → `"dev" | "prod"`) for plain string and `{ label, value }` object choices; widened `string[]` choices infer `string`. The `ChoiceValue` helper type is exported.
  - `input()` and `password()` take Standard Schemas through the dedicated `schema` option; `validate` is function-only, follows the `void` return contract, and cannot be combined with `schema` (encoded in the option types).
  - The deprecated spinner exports are removed; import spinner APIs from `@crustjs/progress`.
  - Trim the custom-prompt utility surface to the prompt engine, text editing, and fuzzy matching APIs. Formatting and list-normalization helpers, `NormalizedChoice`, and `CURSOR_CHAR` are no longer exported.
  - Fix multifilter selection when duplicate choices share a label and value, and preserve the initial cursor when the first default value is `undefined`.

- [#307](https://github.com/chenxin-yan/crust/pull/307) [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Modernize the runtime support matrix and package builds.
  
  - Supported runtimes: Bun 1.3.14+, Node.js 22+, and Deno 2.8+. Package runtime code is portable across all three — Bun globals are replaced with Node-compatible built-ins, and process spawning uses `node:child_process`. On runtimes without `AsyncDisposableStack` (Node 22/23), invocations fall back to an in-package disposal stack.
  - Package builds migrate to tsdown (Rolldown) and modules are marked side-effect free. Internal `@crustjs/utils` imports are inlined, fixing `@crustjs/store` installs that previously required `@crustjs/utils` at runtime. Consumers bundling with Bun 1.3.10–1.3.13 may encounter oven-sh/bun#27709 when tree-shaking packages with `sideEffects: false`.
  - All packages that ship type declarations declare an optional `typescript: "^7.0.0"` peerDependency. Builder inference performance is measured and supported against the native TypeScript 7 compiler; plain-JavaScript consumers are unaffected.

- [#320](https://github.com/chenxin-yan/crust/pull/320) [`58fd65d`](https://github.com/chenxin-yan/crust/commit/58fd65d8efcba8dcad4652d11abb2bef62f32da9) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Remove unused generic, prompt transcript, and field metadata APIs.

- [#338](https://github.com/chenxin-yan/crust/pull/338) [`85d7aa4`](https://github.com/chenxin-yan/crust/commit/85d7aa4ee5010f82622ca6f0d9e81e85f99255ee) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Add `withTerminalIO()` to prompts and progress so prompts, spinners, and progress indicators share one ambient input/output scope. Existing `withPromptIO()` and `withProgressSink()` APIs remain as focused aliases, and `ProgressSink` now accepts writable-compatible outputs with optional TTY metadata.

### Patch Changes

- [#338](https://github.com/chenxin-yan/crust/pull/338) [`85d7aa4`](https://github.com/chenxin-yan/crust/commit/85d7aa4ee5010f82622ca6f0d9e81e85f99255ee) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Start multiselect prompts on the first default choice, matching multifilter, while preserving array-valued choices as scalar defaults in select and filter prompts.

- [#338](https://github.com/chenxin-yan/crust/pull/338) [`85d7aa4`](https://github.com/chenxin-yan/crust/commit/85d7aa4ee5010f82622ca6f0d9e81e85f99255ee) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Make `isTTY()` and `assertTTY()` default to the resolved ambient prompt input instead of always reading `process.stdin`. `resolvePromptIO()` is now exported for custom prompt lifecycle checks.
- Updated dependencies [[`8e9fe39`](https://github.com/chenxin-yan/crust/commit/8e9fe3996832f0e6327bead3e82888d58df6201a), [`85d7aa4`](https://github.com/chenxin-yan/crust/commit/85d7aa4ee5010f82622ca6f0d9e81e85f99255ee), [`85d7aa4`](https://github.com/chenxin-yan/crust/commit/85d7aa4ee5010f82622ca6f0d9e81e85f99255ee), [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce), [`8e9fe39`](https://github.com/chenxin-yan/crust/commit/8e9fe3996832f0e6327bead3e82888d58df6201a), [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce)]:
  - @crustjs/style@0.3.0

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

- 3421dbf: Unified validator contract: throw on fail, void on success.

  Every hand-rolled function validator across the workspace now follows the
  **same rule**: return `void` (or `Promise<void>`) when the value is valid;
  **throw an `Error`** to reject. The thrown error's `message` is what the
  caller surfaces (rendered inline by prompts, captured as the issue text by
  store).

  This unifies what was previously two contracts:

  | Surface                                                | Before                                                 | After                                             |
  | ------------------------------------------------------ | ------------------------------------------------------ | ------------------------------------------------- |
  | `@crustjs/prompts` `input()` / `password()` `validate` | `(v) => true \| string \| Promise<…>`                  | `(v) => void \| Promise<void>`, throws on failure |
  | `@crustjs/store` `FieldDef.validate`                   | `(v) => void \| Promise<void>` (already throw-on-fail) | unchanged                                         |

  ### `@crustjs/prompts` (major) — breaking change

  `ValidateFn<T>` is now `(value: T) => void | Promise<void>`. Throw to
  reject. The `ValidateResult` type alias is removed (there is no return
  value).

  ```ts
  // Before
  input({
  	message: "Email?",
  	validate: (v) => v.includes("@") || "Must contain @",
  });

  // After
  input({
  	message: "Email?",
  	validate: (v) => {
  		if (!v.includes("@")) throw new Error("Must contain @");
  	},
  });
  ```

  Inline error rendering is unchanged — prompts catches the thrown `Error`
  and renders `err.message` below the prompt, identical to how schema issues
  are rendered.

  A runtime **fail-fast guard** is added: if a `validate` function returns
  any value other than `undefined`, prompts throws a `TypeError` naming the
  unexpected return type. This catches the common migration mistake of
  leaving a `return true || "..."` expression in place.

  Schema-driven validation (`validate: zSchema`) is unchanged.

  ### `@crustjs/store` (patch)

  Same fail-fast guard added to `FieldDef.validate`: returning any value
  other than `undefined` now throws a `TypeError`. The throw-on-fail
  contract has always been the documented one — the guard prevents the
  silent-success bug that came from older docs incorrectly suggesting a
  `{ ok, value } | { ok, issues }` return shape.

  Existing throw-based custom validators are unaffected.

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
