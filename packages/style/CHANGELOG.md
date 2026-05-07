# @crustjs/style

## 0.2.0

### Minor Changes

- 075490b: **Color redesign:** added a single canonical `fg` / `bg` pair powered by
  [`Bun.color()`](https://bun.com/docs/runtime/color), plus depth-aware
  fallback so dynamic colors automatically downgrade to `ansi-256` or
  `ansi-16` on terminals that don't support truecolor. The earlier
  `rgb` / `bgRgb` / `hex` / `bgHex` helpers (and their `*Code` /
  `style.*` variants) are kept as `@deprecated` aliases and will be
  removed in v1.0.0.

  ### Added

  - `fg(text, input)` / `bg(text, input)` — apply a foreground or
    background color from anything `Bun.color()` accepts. Output adapts to
    the resolved `ColorDepth` (see _Fallback_ below).
  - `fgCode(input)` / `bgCode(input)` — deterministic `AnsiPair` factories
    for composition. Always emit `ansi-16m`; runtime capability gating
    happens at apply time.
  - `style.fg(text, input)` / `style.bg(text, input)` on style instances
    and the runtime `style` facade.
  - `ColorInput` type — accepted by every dynamic-color helper.
  - `ColorDepth` type — `"truecolor" | "256" | "16" | "none"`.
  - `resolveColorDepth(mode, overrides?)` — resolves the active color
    depth for any emission decision.
  - `colorDepth` property on `StyleInstance` (and the default `style`
    facade).

  ### Deprecated

  The following exports continue to work with their original signatures
  and error contracts (`RangeError` for out-of-range RGB, `TypeError` for
  malformed hex). They emit `@deprecated` JSDoc warnings in IDEs and
  `tsc`, and will be removed in v1.0.0. Migrate at your leisure.

  | Deprecated                     | Replacement                                                       |
  | ------------------------------ | ----------------------------------------------------------------- |
  | `rgb(text, r, g, b)`           | `fg(text, [r, g, b])`                                             |
  | `bgRgb(text, r, g, b)`         | `bg(text, [r, g, b])`                                             |
  | `hex(text, "#rrggbb")`         | `fg(text, "#rrggbb")`                                             |
  | `bgHex(text, "#rrggbb")`       | `bg(text, "#rrggbb")`                                             |
  | `rgbCode(r, g, b)`             | `fgCode([r, g, b])`                                               |
  | `bgRgbCode(r, g, b)`           | `bgCode([r, g, b])`                                               |
  | `hexCode("#rrggbb")`           | `fgCode("#rrggbb")`                                               |
  | `bgHexCode("#rrggbb")`         | `bgCode("#rrggbb")`                                               |
  | `parseHex("#rrggbb")`          | Pass the hex string directly to `fg` / `bg` / `fgCode` / `bgCode` |
  | `style.rgb(text, r, g, b)`     | `style.fg(text, [r, g, b])`                                       |
  | `style.bgRgb(text, r, g, b)`   | `style.bg(text, [r, g, b])`                                       |
  | `style.hex(text, "#rrggbb")`   | `style.fg(text, "#rrggbb")`                                       |
  | `style.bgHex(text, "#rrggbb")` | `style.bg(text, "#rrggbb")`                                       |

  ### Input surface

  `fg`, `bg`, `fgCode`, and `bgCode` accept any input `Bun.color()`
  understands:

  - Hex (`"#f00"`, `"#ff0000"`, `"#ff000080"`)
  - Named CSS colors (`"red"`, `"rebeccapurple"`)
  - `rgb()` / `rgba()` strings (`"rgb(0, 128, 255)"`)
  - `hsl()` / `hsla()` strings (`"hsl(120, 100%, 50%)"`)
  - `lab()` strings
  - Numeric literals (`0xff0000`)
  - `{ r, g, b, a? }` objects
  - `[r, g, b]` and `[r, g, b, a]` arrays

  ### Fallback

  Dynamic colors now resolve at runtime against the terminal's color depth:

  | Resolved depth | Detection (in `"auto"` mode)                                                             |
  | -------------- | ---------------------------------------------------------------------------------------- |
  | `"truecolor"`  | `COLORTERM=truecolor\|24bit`, or `TERM` contains `truecolor`/`24bit`/ends with `-direct` |
  | `"256"`        | `TERM` contains `256color`                                                               |
  | `"16"`         | Any other TTY value                                                                      |
  | `"none"`       | Not a TTY, `NO_COLOR=1`, `TERM=dumb`, or `mode === "never"`                              |

  - Standalone `fg` / `bg` resolve depth on every call through the runtime
    `style` facade, so `setGlobalColorMode("never")`, `NO_COLOR=1`, and
    changes to `TERM` / `COLORTERM` continue to gate emission as expected.
  - `style.fg` / `style.bg` on instances created by `createStyle()` capture
    the depth at construction time (consistent with how `mode` is locked).
  - Invalid color inputs raise `TypeError` at every depth — including
    `"none"` — so user bugs are not silently masked when colors are off.
  - The deprecated helpers above are still gated on `trueColorEnabled`
    exactly as before; they don't participate in depth fallback.

  ### Compatibility

  - All deprecated exports keep their original behavior, signatures, and
    error contracts.
  - Truecolor escape bytes from `fg` / `fgCode` for the same input are
    byte-identical to the deprecated helpers (e.g. `fg("x", [0, 128, 255])`
    produces the exact same sequence as `rgb("x", 0, 128, 255)`).
  - `trueColorEnabled` is retained on `StyleInstance` and equals
    `colorDepth === "truecolor"`.

  ### Public API removed

  - `resolveColorCapability(mode, overrides?)` and
    `resolveTrueColorCapability(mode, overrides?)` have been removed in
    favor of `resolveColorDepth(mode, overrides?)`. They were thin
    wrappers over the depth resolver:
    - `resolveColorCapability(...)` → `resolveColorDepth(...) !== "none"`
    - `resolveTrueColorCapability(...)` → `resolveColorDepth(...) === "truecolor"`
      Migrating: replace each call with the equivalent comparison. The
      depth tier carries strictly more information — e.g.
      `resolveTrueColorCapability(...) === false` previously hid whether
      the terminal supported `"256"` or `"16"` color; the depth value
      surfaces that distinction directly. The instance properties
      `style.colorsEnabled` and `style.trueColorEnabled` remain available
      for already-resolved styles.

- 075490b: **DX upgrade — chains, tagged templates, and defensive inputs.**

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
    style.bold.fg("#ff8800")("warning"); // extension
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
  - **`TERM=dumb` is now matched case-insensitively** in
    `resolveColorDepth` (`DUMB` / `Dumb` / `dUmB` previously fell through
    to `"16"` instead of `"none"`).

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

- 82f5ad6: **Strict inline color literals — typo-safe `fg` / `bg`.**

  Inline string literals passed to `fg` / `bg` / `fgCode` / `bgCode` (and
  the corresponding `style.fg` / `style.bg` / chain `.fg` / `.bg` methods)
  are now validated at compile time against a `StrictColorString` subset:

  - 148 CSS named colors (e.g. `"rebeccapurple"`)
  - `#rrggbb` / `#rgb` / `#rrggbbaa` hex
  - CSS color-function notation: `rgb()`, `rgba()`, `hsl()`, `hsla()`,
    `hwb()`, `lab()`, `lch()`, `oklab()`, `oklch()`, `color()`,
    `color-mix()`

  ```ts
  fg("ok", "rebeccapurple"); // ✅ valid named color
  fg("ok", "#ff0000"); // ✅ valid hex
  fg("ok", "oklch(60% 0.2 240)"); // ✅ valid CSS function

  fg("bad", "rebbecapurple"); // ❌ compile error (typo)
  fg("bad", "not-a-color"); // ❌ compile error (arbitrary)
  fg("bad", "ff0000"); // ❌ compile error (missing `#`)
  ```

  Dynamic `string`, `ColorString`, and `ColorInput` values keep flowing
  through unchanged, so theme tokens loaded from JSON / `process.env` /
  arbitrary user input still type-check exactly as before. Template
  literal types validate the _shape_ only; structurally-valid-looking
  literals like `"#"` or `"rgb(banana)"` still type-check and raise
  `TypeError` at runtime via `Bun.color()`.

  The change is delivered as a single generic conditional on each public
  signature — no function overloads and no runtime change. New helper
  types are exported for users who want to build their own strict
  wrappers:

  - `StrictColorString` — the literal subset
  - `CssColorFunctionString` — color-function template branch
  - `NonStringColorInput` — non-string `ColorInput` branches
  - `ColorInputCandidate` — generic constraint
  - `CheckedColorInput<T>` — conditional helper

  **Public surface trimmed.** Three exports with no documented use case
  were removed from the package root. Each remains importable inside the
  package but is no longer part of the public API:

  | Removed export                 | Migration                                                  |
  | ------------------------------ | ---------------------------------------------------------- |
  | `LiteralUnion`                 | Use `NamedColor` directly, or your own `string & {}` shape |
  | `buildDefaultMarkdownTheme(s)` | `createMarkdownTheme({ style: { mode: ... } })`            |
  | `reset` (ANSI `\x1b[0m`)       | Use `"\x1b[0m"` directly                                   |

  Deprecated v0.x compatibility helpers (`rgb`, `hex`, `parseHex`, etc.)
  are unaffected and remain exported until v1.0.0 per the bun-color
  redesign contract.

## 0.1.0

### Minor Changes

- df08a3a: Add NO_COLOR-aligned runtime color control.

  `@crustjs/style` now disables colors, but not non-color modifiers, when `NO_COLOR` is set to a non-empty value or when output is non-interactive in auto mode. The default exports also support runtime color overrides via `setGlobalColorMode()` and `getGlobalColorMode()`.

  `@crustjs/plugins` now includes `noColorPlugin()`, which adds `--color` and `--no-color` to a Crust CLI and applies the override for the current run.

  **Breaking:** The capability resolver exports have been renamed for symmetry with the new `resolveModifierCapability`:

  - `resolveCapability` → `resolveColorCapability`
  - `resolveTrueColor` → `resolveTrueColorCapability`

### Patch Changes

- df08a3a: Fix `apply()` stripping modifier ANSI codes when only colors are disabled (e.g. `NO_COLOR` on a TTY). `apply()` now distinguishes registered modifier pairs from color pairs and gates each on `modifiersEnabled` / `colorsEnabled` independently, matching the behaviour of chained methods like `s.bold()`.

  Centralize modifier classification in `styleMethodRegistry` via new `modifierNames`, `isModifierName`, and `isModifierPair` exports, removing the hardcoded modifier list duplicated in `applyChain`. A compile-time assertion enforces that every modifier name remains a valid registered style method.

- 67a9f25: Add OSC 8 hyperlink styling primitives to `@crustjs/style` via `linkCode()`, `link()`, and `style.link()`, so CLIs can emit clickable terminal links instead of only visually styled link text.

  Hyperlinks now follow the package's mode-aware runtime behaviour: they emit in `always` mode, emit in `auto` mode when stdout is a TTY, and return plain text in `never` mode. The package docs now also explain how OSC 8 link emission relates to the markdown theme's visual link slots.

## 0.0.6

### Patch Changes

- 9b57c50: Honor explicit capability overrides even when they are set to `undefined` so
  auto color detection stays deterministic in tests and other controlled
  environments.

## 0.0.5

### Patch Changes

- 944f852: Remove `stripAnsi` export from `@crustjs/style`. Users should use Bun's built-in `Bun.stripANSI()` function instead for stripping ANSI escape sequences from strings.

## 0.0.4

### Patch Changes

- a1f233e: Enable minification for all package builds, reducing bundle sizes by ~27%. Also shorten error messages in `@crustjs/core` for smaller output.

## 0.0.3

### Patch Changes

- 6d666b3: Add truecolor (24-bit) RGB and hex color support.

  New direct styling functions: `rgb`, `bgRgb`, `hex`, `bgHex`. New ANSI pair factories for composition: `rgbCode`, `bgRgbCode`, `hexCode`, `bgHexCode`, and `parseHex` for hex-to-RGB conversion.

  Truecolor capability detection via `resolveTrueColor()` gates dynamic colors in `"auto"` mode using `COLORTERM` and `TERM` environment variable heuristics. In `"always"` mode, truecolor sequences are always emitted. In `"never"` mode, plain text is returned. Dynamic color methods are also available on `StyleInstance` (`style.rgb(...)`, `style.hex(...)`, etc.) with the same mode-aware gating.

  No automatic fallback to 256 or 16 colors — unsupported terminals may approximate or ignore truecolor sequences without runtime errors.

## 0.0.2

### Patch Changes

- 0092dcc: Add chainable style composition via property access, enabling usage like `style.bold.red("text")` while preserving existing call syntax.

  Derive style method names and mappings from a single registry so runtime behavior and TypeScript types stay in sync when ANSI methods are added or changed.

## 0.0.1

### Patch Changes

- 051fd44: Introduce @crustjs/style — a terminal styling foundation for Crust with ANSI-safe styling primitives, color mode awareness (auto/always/never), ANSI-aware text layout utilities, list and table block helpers, and a semantic markdown theme covering all GFM constructs. Zero runtime dependencies.
