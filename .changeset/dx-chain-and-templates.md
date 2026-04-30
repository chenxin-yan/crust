---
"@crustjs/style": minor
---

**DX upgrade — chains, tagged templates, and defensive inputs.**

The `style.bold.red(...)` chain API now supports tagged template literals,
dynamic-color extensions, and reuse as ANSI pairs. Every chainable is
simultaneously a function, a chain root, and an `AnsiPair`.

### Added

- **Chainable getters carry `open` / `close`**: every `ChainableStyleFn`
  (e.g. `style.bold`, `style.bold.red`, top-level `bold`) now extends
  `AnsiPair`. `composeStyles(bold, red, bgYellow)` and
  `applyStyle("error", style.bold.red)` work without going through the
  `*Code` factories.
- **Tagged template literals**:
  ```ts
  style.bold.red`Build in ${ms}ms`;
  style.bold`Build ${style.cyan`./dist`} in ${ms}ms`; // nested
  ```
- **`fg` / `bg` chain methods and chain-root form**:
  ```ts
  style.bold.fg("#ff8800")("warning");          // extension
  style.fg("rebeccapurple").italic("emphasis"); // chain root (1-arg)
  ```
- **Optional `depth` parameter on standalone `fg` / `bg`**:
  `fg("text", "#ff8800", "256")` for deterministic output without
  `createStyle()`.
- **Top-level helpers are forwarders**: `bold`, `red`, etc. and
  `style.bold` etc. re-resolve the current runtime instance on every
  call/property access. Captured references like `const myBold = bold`
  honor later `setGlobalColorMode()` flips.

### Behavior changes

- **`fg("", "garbage")` now throws** `TypeError: Invalid color input: "garbage"`.
  The color is validated before any empty-text short-circuit, so callers
  can no longer accidentally mask invalid color bugs by passing empty
  strings.
- **Nullish text returns `""` defensively**: `red(undefined)`,
  `bold(null)`, and `applyStyle(null, pair)` previously crashed with
  `TypeError: undefined is not an object` from inside `String.prototype.includes`.
  They now return `""` (matching ansis semantics). JS callers that
  bypass TypeScript types no longer crash.
- **`style.link` validates URLs even when hyperlinks are disabled**:
  invalid URLs throw `TypeError` regardless of TTY / mode, so callers
  can't smuggle malformed URLs through non-TTY paths.

### Improved

- **Hyperlink error messages echo the bad value**: `Invalid hyperlink URL: "https://example.com/with space" must contain only printable ASCII characters without spaces.`
- **JSDoc filled in** for `setGlobalColorMode`, `getGlobalColorMode`,
  `link`, `linkCode`, `fgCode`, `bgCode`. The `setGlobalColorMode` doc
  now describes capture semantics: top-level / leaf forwarders re-resolve;
  sub-chain captures (`const x = style.bold.red`) snapshot at access
  time (matching chalk / ansis).

### Caveats

- Captured sub-chains snapshot at access time. To stay dynamic, capture
  the leaf and chain at the call site (`const fmt = style.bold; fmt.red("x")`).
- `chain.open + text + chain.close` matches `chain(text)` only when
  adjacent chain steps have distinct close codes. Same-close adjacent
  steps (e.g. `bold.dim`) emit re-open bytes inside `chain(text)` that
  are not part of `chain.close`. Use `chain(text)` for emission and
  reserve `open` / `close` for `composeStyles` / `applyStyle`.
