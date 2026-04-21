# @crustjs/style

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
