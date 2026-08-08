# @crustjs/progress

## 0.1.0

### Minor Changes

- [#169](https://github.com/chenxin-yan/crust/pull/169) [`048edf2`](https://github.com/chenxin-yan/crust/commit/048edf27d71b05e89426010064bf7c5be37fc0c6) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Remove `createTheme` from `@crustjs/prompts` and `@crustjs/progress`. It was a redundant wrapper: partial theme overrides already merge onto `defaultTheme` themselves. Replace `createTheme({...})` with a plain partial theme passed to `createPrompts({ theme: {...} })` / `createProgress({ theme: {...} })` or a per-call `theme` option. To read the fully resolved theme (e.g. for custom `runPrompt` renderers), use the `theme` property on a `createPrompts` instance.

- [#170](https://github.com/chenxin-yan/crust/pull/170) [`555b150`](https://github.com/chenxin-yan/crust/commit/555b1506b4eb0670bb82f8fddb5ec41118d7c257) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Replace global theme state with explicit themed instances (breaking):

  - Removed `setTheme` from both packages and `getTheme` from `@crustjs/prompts`. There is no module-global theme anymore.
  - New `createPrompts({ theme })` in `@crustjs/prompts` returns all prompt functions bound to a theme, plus the resolved `theme` for custom `runPrompt` renderers.
  - New `createProgress({ theme })` in `@crustjs/progress` returns themed `progress`/`spinner`.
  - `runPrompt`'s `theme` config is now an optional partial merged onto `defaultTheme`.
  - Resolution order everywhere: `defaultTheme` ← instance theme ← per-call `theme` option.

  Migration: `setTheme({...})` → `const p = createPrompts({ theme: {...} })` and call `p.input(...)` etc.; `getTheme()` → `p.theme`.

- [#139](https://github.com/chenxin-yan/crust/pull/139) [`0ce45f4`](https://github.com/chenxin-yan/crust/commit/0ce45f4cd41cc4c9ef4181a23ea6360fd756b49b) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Deduplicate prompt internals, remove the unused progress `getTheme` export, and simplify spinner and man-page rendering.

- [#152](https://github.com/chenxin-yan/crust/pull/152) [`ff01466`](https://github.com/chenxin-yan/crust/commit/ff01466931a7f0616ac01e9ea6be2285f702344f) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - New primitives: `spinner()` called without a `task` now returns an imperative handle whose `start`/`updateMessage`/`stop(outcome, message?)` can live in different call frames, with `stop("error")` rendering the `✗` final line without throwing — and `progress()` — a determinate `(current/total)` indicator with `advance()`. Both modes accept `sigint: false` to skip the built-in `SIGINT → exit(130)` handler so applications can own cancellation cleanup. Task-mode `spinner({ message, task })` behavior is unchanged.

- [#139](https://github.com/chenxin-yan/crust/pull/139) [`0ce45f4`](https://github.com/chenxin-yan/crust/commit/0ce45f4cd41cc4c9ef4181a23ea6360fd756b49b) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Require Bun 1.3.14 or newer across all published packages and remove the obsolete sync-disposal workaround now that `AsyncDisposableStack.use()` supports `Symbol.dispose`.

### Patch Changes

- [#139](https://github.com/chenxin-yan/crust/pull/139) [`0ce45f4`](https://github.com/chenxin-yan/crust/commit/0ce45f4cd41cc4c9ef4181a23ea6360fd756b49b) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Documentation consolidation: package READMEs are now concise stubs linking to the docs site (crustjs.com), unique README content moved into the docs, and public option/type TSDoc was enriched (descriptions, `@default` tags) to back generated API reference tables. No runtime behavior changes.

- [#157](https://github.com/chenxin-yan/crust/pull/157) [`d535dbb`](https://github.com/chenxin-yan/crust/commit/d535dbb64dd0e0a16efb7ed4e6c3c4371484c4a9) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Refactor spinner terminal lifecycle behind an internal injectable sink for deterministic cleanup and SIGINT testing.

- Updated dependencies [[`30a75dd`](https://github.com/chenxin-yan/crust/commit/30a75dddf9256c102a1ead7165cc81ef1c4ec0f5), [`0ce45f4`](https://github.com/chenxin-yan/crust/commit/0ce45f4cd41cc4c9ef4181a23ea6360fd756b49b), [`0ce45f4`](https://github.com/chenxin-yan/crust/commit/0ce45f4cd41cc4c9ef4181a23ea6360fd756b49b), [`0ce45f4`](https://github.com/chenxin-yan/crust/commit/0ce45f4cd41cc4c9ef4181a23ea6360fd756b49b), [`0ce45f4`](https://github.com/chenxin-yan/crust/commit/0ce45f4cd41cc4c9ef4181a23ea6360fd756b49b), [`40fb8bd`](https://github.com/chenxin-yan/crust/commit/40fb8bd8346a2d248a454104f580b88231377bf2), [`40fb8bd`](https://github.com/chenxin-yan/crust/commit/40fb8bd8346a2d248a454104f580b88231377bf2)]:
  - @crustjs/style@0.3.0

## 0.0.4

### Patch Changes

- Updated dependencies [075490b]
- Updated dependencies [075490b]
- Updated dependencies [82f5ad6]
  - @crustjs/style@0.2.0

## 0.0.3

### Patch Changes

- Updated dependencies [df08a3a]
- Updated dependencies [df08a3a]
- Updated dependencies [67a9f25]
  - @crustjs/style@0.1.0

## 0.0.2

### Patch Changes

- 341f3b1: Add a new `@crustjs/progress` package and move the canonical `spinner()` implementation there.

  `@crustjs/prompts` now temporarily re-exports `spinner` and related types as deprecated compatibility exports, with removal planned for `v0.1.0`.

  Update internal consumers and docs to use `@crustjs/progress` as the new home for spinner-based progress UI.
