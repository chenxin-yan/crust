# @crustjs/prompts

## 0.3.0

### Minor Changes

- [#567](https://github.com/chenxin-yan/crust/pull/567) [`2821b47`](https://github.com/chenxin-yan/crust/commit/2821b479175e77e513330ac5100b50ac159573a7) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Breaking: prompts use the shared terminal IO names.
  
  - `PromptIO`, `PromptInput`, and `PromptOutput` are renamed to `TerminalIO`, `TerminalInput`, and `TerminalOutput`, the same types `@crustjs/progress` exports.
  - The `withPromptIO()` alias is removed; use `withTerminalIO()`, which it pointed to.
  - `resolvePromptIO()` is no longer exported; `runPrompt()` applies the same explicit, ambient, then process stream order.

### Patch Changes

- [#539](https://github.com/chenxin-yan/crust/pull/539) [`ce12aed`](https://github.com/chenxin-yan/crust/commit/ce12aed7a34275c49b54340d1995378afedfa2a6) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Remove the `engines.deno` declaration; Deno is no longer supported.

- [#515](https://github.com/chenxin-yan/crust/pull/515) [`0e52e28`](https://github.com/chenxin-yan/crust/commit/0e52e28cef2b18dd7f9774e14be9083ad9167ba5) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - `process.exit()` while a prompt is active restores raw mode and, for synchronous output sinks, the cursor.
  
  The fake terminal behind `createPromptIO()` and `renderPrompt()` (`@crustjs/prompts/testing`) now wraps text at its 80 columns by display width, so `screen()` matches a real terminal for long lines and wide characters.
  
  Text longer than 80 columns is now split across rows in `screen()` (and in `@crustjs/testing`'s `runInteractive()` screen), so assertions that match across the wrap point need to join the rows first.

- [#513](https://github.com/chenxin-yan/crust/pull/513) [`6ef96cd`](https://github.com/chenxin-yan/crust/commit/6ef96cdc8349991ca77360e906f6ae56863cc38b) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Decide default theme colors from the stream a prompt or spinner writes to instead of stdout. Prompts and spinners on a terminal stderr are now colored when stdout is piped, and redirected stderr no longer receives ANSI escapes when stdout is a terminal. `NO_COLOR` and `FORCE_COLOR` apply as before; theme functions you pass are unchanged.

- [#514](https://github.com/chenxin-yan/crust/pull/514) [`1a688e6`](https://github.com/chenxin-yan/crust/commit/1a688e64357a522fbd9add9cd6054b102a517f11) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - `input()` and `password()` now run `validate` on `initial` values; `input()` also validates non-interactive `default` values, throwing `initial value rejected: …` / `default value rejected: …` like the `schema` path already did.
  
  Prompts render only when both their input and their output are TTYs. With a redirected output (for example `mycli 2> log.txt`, or `app.run()` without injected terminal IO) they return `default` or reject with `NonInteractiveError` instead of drawing into the stream and waiting for keys. Custom outputs must set `isTTY: true` to render prompts.
  
  `select()`, `multiselect()`, `filter()`, and `multifilter()` reject a `default` or `initial` outside literal `choices` at compile time instead of widening the result type. Dynamic choice arrays and explicit type arguments are unchanged.
  
  Also fixes:
  
  - Multiselect `a` (toggle all) clears the selection when `max` is reached.
  - Tab and other control characters are no longer inserted into text input, password, and filter queries. Ctrl+J submits like Enter: `runPrompt()` reports it as `return`.
  - Fuzzy match highlighting lands on the right characters when lowercasing changes a label's length (for example `İ`).
  - `input()` with a `schema` shows the submitted text instead of `String(output)` (such as `[object Object]`).

- [#589](https://github.com/chenxin-yan/crust/pull/589) [`db2f5b3`](https://github.com/chenxin-yan/crust/commit/db2f5b391ccbcc6750e98e9219511ecf0820baf6) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Add `createPlainStyle()`: plain style functions (`bold`, `red`, …) with fixed settings. It takes the same options as `createStyle()` and gives the same output, without chaining, `open`/`close`, or `fg`/`bg`, so importing it does not bundle the chain engine. Pass `overrides: { isTTY }` to decide color for a stream other than stdout. Its return type, `PlainStyle`, is exported.
  
  The default themes of `@crustjs/prompts` and `@crustjs/progress` use it to decide color from their own output stream, so apps that use prompts or spinners no longer bundle the chain engine. Output is unchanged.
- Updated dependencies [[`6fdb8a6`](https://github.com/chenxin-yan/crust/commit/6fdb8a642b79a176d60d9a3d4be3431493201052), [`ce12aed`](https://github.com/chenxin-yan/crust/commit/ce12aed7a34275c49b54340d1995378afedfa2a6), [`ce12aed`](https://github.com/chenxin-yan/crust/commit/ce12aed7a34275c49b54340d1995378afedfa2a6), [`643beb2`](https://github.com/chenxin-yan/crust/commit/643beb264f5b206177110dd947b258f47cc68073), [`708e181`](https://github.com/chenxin-yan/crust/commit/708e181f0de97b81b77d64261f754e2649af1761), [`4a4386d`](https://github.com/chenxin-yan/crust/commit/4a4386d64fdef5440e77cebd8b9ac85e7a1d7350), [`4208178`](https://github.com/chenxin-yan/crust/commit/420817832f065c875e836b86deac832f84d86828), [`d64f307`](https://github.com/chenxin-yan/crust/commit/d64f30727fd3d28dcb26b7edeb6aed929a3efe19), [`e802ec7`](https://github.com/chenxin-yan/crust/commit/e802ec7c09c6635d77716e3c1c545faa99fe7759), [`db2f5b3`](https://github.com/chenxin-yan/crust/commit/db2f5b391ccbcc6750e98e9219511ecf0820baf6), [`6ef96cd`](https://github.com/chenxin-yan/crust/commit/6ef96cdc8349991ca77360e906f6ae56863cc38b), [`bc85878`](https://github.com/chenxin-yan/crust/commit/bc858780958074fad17424509e5a4190e5e7d468), [`f49de57`](https://github.com/chenxin-yan/crust/commit/f49de57eb0d77220617792669fb185f1e20e656d), [`6ce95ed`](https://github.com/chenxin-yan/crust/commit/6ce95edb85095d8e8c3ab27fed8226d320fc3d82), [`7811b12`](https://github.com/chenxin-yan/crust/commit/7811b12f73827e1d47a1574c4b88736eb82632b0), [`3a6dbb1`](https://github.com/chenxin-yan/crust/commit/3a6dbb1702cff684c17054cd476ddef0b5d56f99)]:
  - @crustjs/utils@0.3.0
  - @crustjs/style@0.4.0

## 0.2.6

### Patch Changes

- [#483](https://github.com/chenxin-yan/crust/pull/483) [`e7db3a0`](https://github.com/chenxin-yan/crust/commit/e7db3a0dec77bd5bff375275daa3c83e5a350444) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - List prompts with no choices no longer render a stray `...` scroll indicator.

- [#483](https://github.com/chenxin-yan/crust/pull/483) [`e7db3a0`](https://github.com/chenxin-yan/crust/commit/e7db3a0dec77bd5bff375275daa3c83e5a350444) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - `filter()` now renders choice `hint`s, matching `select()`, `multiselect()`, and `multifilter()`.

- [#483](https://github.com/chenxin-yan/crust/pull/483) [`e7db3a0`](https://github.com/chenxin-yan/crust/commit/e7db3a0dec77bd5bff375275daa3c83e5a350444) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - `password()` now shows one mask character per typed character, including emoji and other astral code points.
- Updated dependencies [[`1f7b266`](https://github.com/chenxin-yan/crust/commit/1f7b26648e412d0c6170c2866fb6ec97aa907f14)]:
  - @crustjs/style@0.3.6

## 0.2.5

### Patch Changes

- [#469](https://github.com/chenxin-yan/crust/pull/469) [`1984299`](https://github.com/chenxin-yan/crust/commit/1984299962d29641ed1b9741f1ed252a1b3f8e1b) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Raise the minimum supported Node.js version to 24. Remove the Node 22 disposal-stack fallback and use native AsyncDisposableStack on all supported runtimes. Update generated Node projects to require Node 24 and use @types/node 24.
- Updated dependencies [[`1984299`](https://github.com/chenxin-yan/crust/commit/1984299962d29641ed1b9741f1ed252a1b3f8e1b)]:
  - @crustjs/style@0.3.5
  - @crustjs/utils@0.2.1

## 0.2.4

### Patch Changes

- [#463](https://github.com/chenxin-yan/crust/pull/463) [`c6f4bd8`](https://github.com/chenxin-yan/crust/commit/c6f4bd8f3de3558d9c988acf63830ec899cf6854) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Edit supplementary Unicode characters such as emoji in text prompts without splitting surrogate pairs

- [#463](https://github.com/chenxin-yan/crust/pull/463) [`c6f4bd8`](https://github.com/chenxin-yan/crust/commit/c6f4bd8f3de3558d9c988acf63830ec899cf6854) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Fix multiselect with empty choices bypassing required/min validation
- Updated dependencies [[`0da2c5c`](https://github.com/chenxin-yan/crust/commit/0da2c5ce54f71acc5d51fad1dcb2c5546a71948e), [`c6f4bd8`](https://github.com/chenxin-yan/crust/commit/c6f4bd8f3de3558d9c988acf63830ec899cf6854), [`4360cb1`](https://github.com/chenxin-yan/crust/commit/4360cb1cefca245e76967ade43c82b5361c039e5), [`4977f33`](https://github.com/chenxin-yan/crust/commit/4977f33e87a928d968202af40f9729e390b7df93), [`4977f33`](https://github.com/chenxin-yan/crust/commit/4977f33e87a928d968202af40f9729e390b7df93)]:
  - @crustjs/utils@0.2.0
  - @crustjs/style@0.3.4

## 0.2.3

### Patch Changes

- [#411](https://github.com/chenxin-yan/crust/pull/411) [`2cbdc21`](https://github.com/chenxin-yan/crust/commit/2cbdc2122f7bffbad42b79185bf0e4d8d97021a7) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Depend on the published `@crustjs/utils` package instead of inlining its sources into the bundle.
- Updated dependencies [[`2cbdc21`](https://github.com/chenxin-yan/crust/commit/2cbdc2122f7bffbad42b79185bf0e4d8d97021a7)]:
  - @crustjs/utils@0.1.0

## 0.2.2

### Patch Changes

- [#396](https://github.com/chenxin-yan/crust/pull/396) [`015bcdb`](https://github.com/chenxin-yan/crust/commit/015bcdb1e9ca9285d3029794c573bb3f3ea3aa73) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Ignore pending key-handler results after prompt cleanup so a failed render cannot leave stale output in a replacement prompt.

- [#396](https://github.com/chenxin-yan/crust/pull/396) [`015bcdb`](https://github.com/chenxin-yan/crust/commit/015bcdb1e9ca9285d3029794c573bb3f3ea3aa73) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Constrain plain-string `Choice<T>` values to `T & string`, so `select<number>`, `filter<number>`, `multiselect<number>` and `multifilter<number>` (and literal-union `T`) reject strings that could not be a `T` value instead of submitting a string where the caller was promised another type. Object choices, literal-tuple narrowing, widened `string[]` choices, and generic wrappers are unchanged. Callers relying on the previously accepted unsound strings must use `{ label, value }` objects or widen `T`.
  
  `runPrompt()` now catches errors thrown by a deferred re-render and rejects the prompt promise after restoring raw mode, the cursor, and stream reservations, instead of surfacing an uncaught timer exception with the prompt left pending.
- Updated dependencies [[`015bcdb`](https://github.com/chenxin-yan/crust/commit/015bcdb1e9ca9285d3029794c573bb3f3ea3aa73)]:
  - @crustjs/style@0.3.2

## 0.2.1

### Patch Changes

- [#371](https://github.com/chenxin-yan/crust/pull/371) [`d103a76`](https://github.com/chenxin-yan/crust/commit/d103a7688dd3240c913596e46f6100b772ded80d) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Raise the supported Bun floor to 1.4.0.
  
  Every package now declares `engines.bun` as `>=1.4.0`, and Bun 1.3 is no longer tested. Bun 1.4 ships a single x64 binary, which is what lets `crust build` use the canonical `bun-linux-x64` and `bun-windows-x64` target names.
- Updated dependencies [[`d103a76`](https://github.com/chenxin-yan/crust/commit/d103a7688dd3240c913596e46f6100b772ded80d)]:
  - @crustjs/style@0.3.1

## 0.2.0

### Minor Changes

- [#307](https://github.com/chenxin-yan/crust/pull/307) [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Breaking: themed prompt instances, injectable terminal IO, and typed choice results.
  
  - `setTheme`, `getTheme`, and `createTheme` are removed. Migrate global themes to `const p = createPrompts({ theme })`; `p` exposes every prompt plus its resolved `theme` for custom renderers. Theme resolution is `defaultTheme` ← instance ← per-call; `runPrompt` accepts an optional partial theme. `CreatePromptsOptions` and `PromptsInstance` are exported.
  - Ctrl+C rejects with a `DOMException` named `"AbortError"` instead of `CancelledError`; check `err.name === "AbortError"`.
  - Prompts and `runPrompt` accept optional `PromptIO` (`{ input?, output? }`). `withTerminalIO(io, fn)` shares streams with prompts and `@crustjs/progress` in an async scope; `withPromptIO` is an alias. Resolution is explicit IO → ambient scope → `process.stdin`/`process.stderr`. `resolvePromptIO(io?)` exposes the resolved streams; `isTTY(input?)`/`assertTTY(input?)` default to the resolved input. `PromptIO`, `PromptInput`, and `PromptOutput` are exported.
  - New `@crustjs/prompts/testing` provides `renderPrompt`, `createPromptIO`, and `encodeKey` for fake-terminal tests with `type()`, `keys()`, `screen()`, and `answer`. Exported types include `Key`, `NamedKey`, `PromptTestIO`, and `RenderedPrompt`; named keys autocomplete, while control keys and single characters remain accepted.
  - `select`, `multiselect`, `filter`, and `multifilter` infer literal choice-value unions for strings and `{ label, value }` choices; widened arrays retain their wider type. `ChoiceValue` is exported.
  - `input`/`password` accept Standard Schema through `schema`; migrate `validate: schema` to `schema`. `validate` is function-only and cannot combine with `schema` (checked statically and at runtime). Non-`undefined` validator returns are now ignored rather than raising `TypeError`; throw an error to reject input.
  - Deprecated spinner re-exports and the `@crustjs/progress` dependency are removed; import spinner APIs directly from `@crustjs/progress`.
  - Custom renderers gain `renderTextWithCursor`, `highlightMatches`, `renderChoiceList`, and glyph exports `PREFIX_SYMBOL`, `PREFIX_SUBMITTED`, `CURSOR_INDICATOR`, `SCROLL_INDICATOR`, `CHECKBOX_CHECKED`, and `CHECKBOX_UNCHECKED`. `formatPromptLine`/`formatSubmitted` remain available. `normalizeChoices`, `NormalizedChoice`, `calculateScrollOffset`, and `CURSOR_CHAR` are removed from the root exports.
  - `multiselect` starts on the first default choice, matching `multifilter`. `multifilter` toggles the highlighted item when duplicates share label and value, and preserves its initial cursor when the first default value is `undefined`.

- [#307](https://github.com/chenxin-yan/crust/pull/307) [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Update runtime compatibility and package builds.
  
  - Libraries support Bun 1.3.14+, Node.js 22+, and Deno 2.8+ (`engines` updated). Context disposal includes a fallback for runtimes without `AsyncDisposableStack`, including Node 22/23. The `crust` build CLI remains Bun tooling; its npm distribution ships standalone executables with Bun embedded.
  - Published packages no longer depend on `@crustjs/utils`; its helpers are bundled. `@crustjs/store` also drops `@standard-schema/spec`. Library packages and `create-crust` are marked `sideEffects: false` for bundlers.
  - Packages shipping declarations declare an optional TypeScript `^7.0.0` peer; builder inference is supported on TypeScript 7. JavaScript consumers are unaffected by this compiler requirement.

### Patch Changes

- Updated dependencies [[`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce), [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce)]:
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
