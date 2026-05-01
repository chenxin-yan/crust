# @crustjs/style

Terminal styling foundation for the [Crust](https://crustjs.com) CLI framework.

`@crustjs/style` provides ANSI-safe styling primitives, terminal capability awareness, layout helpers, and a semantic markdown theme — so CLI output remains readable, aligned, and consistent across color and no-color environments.

Zero runtime dependencies.

## Install

```sh
bun add @crustjs/style
```

## Quick Start

```ts
import { style } from "@crustjs/style";

// The default `style` instance auto-detects color support
console.log(style.bold("Build succeeded"));
console.log(style.red("Error: missing argument"));
console.log(style.dim("hint: use --help for usage"));
console.log(style.bold.red("Critical failure"));
console.log(style.link("Docs", "https://crustjs.com"));
```

## Primitive Styling

Direct styling functions respect the default runtime color policy:

- All ANSI output (colors and modifiers) requires stdout to be a TTY
- `NO_COLOR` disables only color, not modifiers like `bold()` and `underline()`, following [no-color.org](https://no-color.org/)
- Piped / non-interactive output is plain text with no ANSI codes

```ts
import { bold, red, italic, bgYellow } from "@crustjs/style";

console.log(bold("important"));
console.log(red("error"));
console.log(italic("note"));
console.log(bgYellow("highlighted"));
```

### Available Modifiers

`bold`, `dim`, `italic`, `underline`, `inverse`, `hidden`, `strikethrough`

### Available Colors

**Foreground:** `black`, `red`, `green`, `yellow`, `blue`, `magenta`, `cyan`, `white`, `gray`, `brightRed`, `brightGreen`, `brightYellow`, `brightBlue`, `brightMagenta`, `brightCyan`, `brightWhite`

**Background:** `bgBlack`, `bgRed`, `bgGreen`, `bgYellow`, `bgBlue`, `bgMagenta`, `bgCyan`, `bgWhite`, `bgBrightBlack`, `bgBrightRed`, `bgBrightGreen`, `bgBrightYellow`, `bgBrightBlue`, `bgBrightMagenta`, `bgBrightCyan`, `bgBrightWhite`

### Composing Styles

Three composition shapes are supported — pick whichever fits the call site.

#### 1. Chainable getter style (chalk-style)

```ts
import { style } from "@crustjs/style";

console.log(style.bold.red("critical error"));
console.log(style.italic.brightCyan.bgYellow("highlight"));
```

#### 2. Tagged template literals (ansis-style)

```ts
import { style } from "@crustjs/style";

const ms = 42;
console.log(style.bold.red`Build in ${ms}ms`);

// Nested chains inside ${...} re-open the outer style after the inner close.
console.log(style.bold`Build ${style.cyan`./dist`} in ${ms}ms`);
```

#### 3. AnsiPair composition

Every chainable doubles as an `AnsiPair` with `open` / `close` properties,
so it can be passed to `composeStyles` and `applyStyle` without going
through the `*Code` factories. The pre-built `*Code` exports are still
available for callers that prefer pure data:

```ts
import {
  applyStyle,
  composeStyles,
  bold,
  red,
  bgYellow,
  fgCode,
} from "@crustjs/style";

// Mix top-level chainables and AnsiPair factories freely
const danger = composeStyles(bold, red, bgYellow);
console.log(applyStyle("DANGER", danger));

// Dynamic colors compose too
const brand = composeStyles(bold, fgCode("#4FA83D"));
console.log(applyStyle("Crust", brand));
```

#### Dynamic colors in chains

`fg(input)` and `bg(input)` extend any chain (or start a new one):

```ts
style.bold.fg("#ff8800")("warning");
style.fg("rebeccapurple").italic.underline("emphasis");
style.bold.fg("#fff").bg("#dc2626")` ERROR `;
```

Nested styles are handled safely — no style bleed across boundaries.

> **Byte-equivalence caveat**: `chain.open + text + chain.close` matches
> `chain(text)` only when adjacent chain steps have distinct close codes.
> When two adjacent steps share a close code (e.g. `bold` and `dim` both
> close with `\x1b[22m`), `applyStyle` emits an extra re-open after the
> inner close to prevent style bleed. Use `chain(text)` for emission and
> reserve `chain.open` / `chain.close` for `composeStyles` / `applyStyle`.

#### `setGlobalColorMode` and captured references

Top-level helpers (`bold`, `red`, etc.) and `style.bold` are forwarders —
captured references re-resolve the active color mode on every call:

```ts
import { setGlobalColorMode, style, bold } from "@crustjs/style";

setGlobalColorMode("always");
const myBold = style.bold;          // forwarder, dynamic
setGlobalColorMode("never");
myBold("x");                        // honors the new mode
```

**Sub-chain captures snapshot.** `const myBoldRed = style.bold.red`
locks to the chainable resolved at access time. To stay dynamic, capture
the leaf forwarder and chain at the call site:

```ts
const fmt = style.bold;             // dynamic forwarder
fmt.red("x");                       // re-resolves on every chain access
```

This matches chalk and ansis.

## Hyperlinks (OSC 8)

Wrap text in terminal hyperlink escape sequences:

```ts
import { createStyle, linkCode, composeStyles, applyStyle, underlineCode } from "@crustjs/style";

const s = createStyle({ mode: "always" });

console.log(s.link("Crust docs", "https://crustjs.com"));
console.log(s.link("API reference", "https://crustjs.com/docs", { id: "docs-link" }));

const underlinedLink = composeStyles(linkCode("https://crustjs.com"), underlineCode);
console.log(applyStyle("Visit Crust", underlinedLink));
```

In `"auto"` mode, hyperlinks are emitted when stdout is a TTY. They are not disabled by `NO_COLOR`, since OSC 8 links are not color sequences. In `"never"` mode, link methods return plain text.

Terminal support for OSC 8 varies. Many modern terminals support it, but there is no reliable cross-terminal feature probe yet, so unsupported terminals may simply render plain text without clickable behavior.

## Dynamic Colors

A single `fg` / `bg` pair powered by [`Bun.color()`](https://bun.com/docs/runtime/color). Accepts every input Bun.color understands — hex (3/6/8 digit), named CSS colors, `rgb()` / `rgba()`, `hsl()` / `hsla()`, `lab()`, numeric literals, `{ r, g, b, a? }` objects, and `[r, g, b]` / `[r, g, b, a]` arrays. Output adapts to the terminal's resolved color depth (truecolor / 256 / 16 / none) — see [Color Depth & Auto-Fallback](#color-depth--auto-fallback).

```ts
import { fg, bg } from "@crustjs/style";

// Hex (3-, 6-, or 8-digit)
console.log(fg("error", "#ff0000"));
console.log(fg("short", "#f00"));
console.log(bg("highlight", "#ff8800"));

// Named CSS colors
console.log(fg("royal", "rebeccapurple"));

// rgb() / hsl() strings
console.log(fg("ocean", "rgb(0, 128, 255)"));
console.log(bg("sun",   "hsl(45, 100%, 50%)"));

// Numeric literal
console.log(fg("red", 0xff0000));

// Tuple or object
console.log(fg("coral", [255, 127, 80]));
console.log(bg("slate", { r: 100, g: 116, b: 139 }));
```

### `ColorInput`

`fg`, `bg`, `fgCode`, and `bgCode` all accept the same `ColorInput` union:

```ts
type ColorInput =
  | ColorString
  | number
  | readonly [r: number, g: number, b: number]
  | readonly [r: number, g: number, b: number, a: number]
  | { r: number; g: number; b: number; a?: number };

type ColorString = LiteralUnion<NamedColor | `#${string}`, string>;
type NamedColor = "aliceblue" | "antiquewhite" | /* …146 more… */ | "yellowgreen";
```

**Editor autocomplete.** Typing `fg("text", "…")` surfaces all 148 CSS named colors plus `#` as completions. Other strings that `Bun.color()` accepts — `rgb()`, `hsl()`, `lab()`, `oklch()`, etc. — still type-check via the `string` fallback (`LiteralUnion` from [type-fest's pattern](https://github.com/sindresorhus/type-fest/blob/main/source/literal-union.d.ts)).

Invalid inputs raise `TypeError` (`Invalid color input: ...`). The color is validated **before** any empty-text short-circuit, so `fg("", "definitely-not-a-color")` still throws — callers can't silently mask bugs by passing empty strings.

Nullish text (`fg(undefined, "#f00")`, `bold(null)`, etc.) returns `""` defensively. JS callers that bypass TypeScript types still get safe output.

### Pair Factories

Create reusable `AnsiPair` objects for composition:

```ts
import { fgCode, bgCode, applyStyle, composeStyles, boldCode } from "@crustjs/style";

const coral = fgCode("#ff7f50");
console.log(applyStyle("coral text", coral));

const boldCoral = composeStyles(boldCode, fgCode([255, 127, 80]));
console.log(applyStyle("bold coral", boldCoral));
```

### Style Instance

Dynamic colors on `createStyle` instances respect mode and the resolved color depth:

```ts
import { createStyle } from "@crustjs/style";

const s = createStyle({ mode: "always" });
console.log(s.fg("text", "#ff0000"));
console.log(s.fg("text", "rebeccapurple"));
console.log(s.bg("text", [0, 128, 255]));
console.log(s.bg("text", "hsl(210, 100%, 50%)"));
```

In `"auto"` mode, `fg` / `bg` automatically pick the best `Bun.color()` format the terminal supports — see [Color Depth & Auto-Fallback](#color-depth--auto-fallback) below.

In `"never"` mode, `fg` / `bg` return plain text. In `"always"` mode, truecolor sequences are always emitted.

The earlier `rgb` / `bgRgb` / `hex` / `bgHex` (and their `*Code` pair-factory variants, plus matching `style.*` instance methods) still ship and behave exactly as before, but are marked `@deprecated` and will be removed in v1.0.0. IDEs/`tsc` will surface the deprecation with a one-line replacement hint at the call site — prefer `fg` / `bg` for new code.

### Color Depth & Auto-Fallback

`fg` / `bg` are capability-aware: the resolved color depth determines which `Bun.color()` format is emitted on every call. The standalone exports re-resolve on every call, while instances created with `createStyle()` capture the depth at construction time.

| Resolved depth | Output | Detection (in `"auto"` mode) |
| --- | --- | --- |
| `"truecolor"` | `Bun.color(input, "ansi-16m")` | `COLORTERM=truecolor\|24bit`, or `TERM` contains `truecolor`/`24bit`/ends with `-direct` |
| `"256"` | `Bun.color(input, "ansi-256")` | `TERM` contains `256color` |
| `"16"` | In-package RGB → 16-color quantizer (`\x1b[3X/9Xm` fg, `\x1b[4X/10Xm` bg) | Any other TTY value |
| `"none"` | `text` returned unchanged | Not a TTY, `NO_COLOR=1`, `TERM=dumb`, or `mode === "never"` |

The `"16"` row uses an in-package quantizer (same algorithm as `ansi-styles` / `chalk`) pending an upstream Bun fix ([oven-sh/bun#22161](https://github.com/oven-sh/bun/issues/22161)).

Detection follows the existing `NO_COLOR` / `COLORTERM` / `TERM` conventions — no new environment variables. Disable color emission entirely with `setGlobalColorMode("never")` or by setting `NO_COLOR=1`. Force truecolor with `setGlobalColorMode("always")` or `mode: "always"` on `createStyle()`.

Use `resolveColorDepth(mode, overrides?)` to inspect the resolved tier directly, or read `style.colorDepth` / `instance.colorDepth` for the live value:

```ts
import { resolveColorDepth, style } from "@crustjs/style";

resolveColorDepth("auto"); // "truecolor" | "256" | "16" | "none"
style.colorDepth;          // depth currently used by the runtime style
```

Invalid color inputs (e.g., `fg("hello", "not-a-color")`) raise `TypeError` at every depth — including `"none"` — so user bugs are not silently masked when colors are off.

## Color Modes

Control when ANSI codes are emitted using `createStyle`:

```ts
import { createStyle } from "@crustjs/style";

// Auto-detect (default) — respects NO_COLOR and TTY status for colors
const auto = createStyle({ mode: "auto" });

// Always emit ANSI codes
const color = createStyle({ mode: "always" });
console.log(color.red("always red"));
console.log(color.bold.red("always bold red"));

// Never emit ANSI codes — returns plain text
const plain = createStyle({ mode: "never" });
console.log(plain.red("just text")); // "just text"
```

The default `style` export uses `"auto"` mode:

- Color methods emit ANSI when stdout is a TTY and `NO_COLOR` is unset or `""`
- Modifier methods stay enabled in `auto` mode even when `NO_COLOR=1`
- Dynamic colors are disabled whenever base colors are disabled

### NO_COLOR Semantics

`@crustjs/style` follows [no-color.org](https://no-color.org/):

- `NO_COLOR=1` disables color output by default
- `NO_COLOR=""` does not disable color
- `NO_COLOR` does not disable non-color ANSI styling such as bold or underline

### Runtime Color Overrides

The default `style` export and all named helpers (`red`, `bold`, etc.) re-resolve their color mode on every call, so you can override it globally at runtime:

```ts
import { getGlobalColorMode, setGlobalColorMode, style } from "@crustjs/style";

// Force colors on for the remainder of this process
setGlobalColorMode("always");
console.log(style.red("always red"));

// Disable colors but keep bold / italic / underline / hyperlinks (no-color.org)
setGlobalColorMode("never");
console.log(style.bold.red("bold, but no red"));

// Revert to auto (respect TTY + NO_COLOR)
setGlobalColorMode(undefined);

// Read the current override
getGlobalColorMode(); // ColorMode | undefined
```

Instances returned by `createStyle()` are not affected — they capture their mode at creation time. The override only applies to the default `style` facade and the named re-exports.

For a scoped override that only lasts for a single CLI run, use [`noColorPlugin()`](https://crustjs.com/docs/modules/plugins/no-color) from `@crustjs/plugins`, which saves and restores the previous mode around the command invocation.

### Deterministic Testing

Inject capability overrides for predictable test output:

```ts
const testStyle = createStyle({
  mode: "auto",
  overrides: { isTTY: true, noColor: undefined },
});

// Include truecolor overrides for dynamic color testing
const truecolorStyle = createStyle({
  mode: "auto",
  overrides: { isTTY: true, noColor: undefined, colorTerm: "truecolor" },
});
```

## Text Utilities

ANSI-aware text measurement and layout:

```ts
import {
  visibleWidth,
  wrapText,
  padStart,
  padEnd,
  center,
} from "@crustjs/style";

// Strip ANSI escape sequences (Bun built-in)
Bun.stripANSI("\x1b[1mhello\x1b[22m"); // "hello"

// Measure visible width (ignores ANSI codes, counts CJK as 2)
visibleWidth("\x1b[31mhello\x1b[39m"); // 5

// Wrap text to a visible width, preserving active styles across breaks
wrapText("a long line of styled text", 20);
wrapText("force break mode", 10, { wordBreak: false });

// ANSI-safe padding and alignment
padStart("42", 6);   // "    42"
padEnd("name", 10);  // "name      "
center("title", 20); // "       title        "
```

## Block Helpers

Format structured blocks for terminal output:

### Lists

```ts
import { unorderedList, orderedList, taskList } from "@crustjs/style";

unorderedList(["apples", "bananas", "cherries"]);
// • apples
// • bananas
// • cherries

orderedList(["first", "second", "third"]);
// 1. first
// 2. second
// 3. third

taskList([
  { text: "Write tests", checked: true },
  { text: "Update docs", checked: false },
]);
// [x] Write tests
// [ ] Update docs
```

Lists support `indent` for nesting and custom markers.

### Tables

```ts
import { table } from "@crustjs/style";

table(
  ["Name", "Version", "Status"],
  [
    ["core", "1.2.0", "stable"],
    ["style", "0.1.0", "new"],
  ],
);
// | Name  | Version | Status |
// | ----- | ------- | ------ |
// | core  | 1.2.0   | stable |
// | style | 0.1.0   | new    |
```

Tables support per-column alignment (`"left"`, `"right"`, `"center"`), custom padding, and ANSI-styled cell content with correct alignment.

## Markdown Theme

Semantic theme slots for styling GFM (GitHub Flavored Markdown) constructs:

```ts
import { defaultTheme } from "@crustjs/style";

// Apply theme slots to extracted markdown content
console.log(defaultTheme.heading1("Getting Started"));
console.log(defaultTheme.strong("important"));
console.log(defaultTheme.inlineCode("npm install"));
console.log(defaultTheme.linkText("docs") + " " + defaultTheme.linkUrl("https://crustjs.com"));
```

The markdown theme styles how links look, but it does not create OSC 8 hyperlinks by itself. When your renderer has both the label and destination URL, use `style.link()` or `linkCode()` to emit a clickable link.

### Custom Themes

Override specific slots while inheriting defaults:

```ts
import { createMarkdownTheme } from "@crustjs/style";

const theme = createMarkdownTheme({
  style: { mode: "always" },
  overrides: {
    heading1: (text) => `>>> ${text.toUpperCase()} <<<`,
    strong: (text) => `**${text}**`,
  },
});
```

### Theme Slots

The `MarkdownTheme` interface covers 30 GFM slots:

| Category | Slots |
| --- | --- |
| Headings | `heading1` through `heading6` |
| Text | `text`, `emphasis`, `strong`, `strongEmphasis`, `strikethrough` |
| Code | `inlineCode`, `codeFence`, `codeInfo`, `codeText` |
| Links | `linkText`, `linkUrl`, `autolink` |
| Lists | `listMarker`, `orderedListMarker`, `taskChecked`, `taskUnchecked` |
| Blockquotes | `blockquoteMarker`, `blockquoteText` |
| Tables | `tableHeader`, `tableCell`, `tableBorder` |
| Other | `thematicBreak`, `imageAltText`, `imageUrl` |

Theme slots are parser-agnostic `string => string` functions. Markdown parsing and AST handling belong to a separate consumer package — `@crustjs/style` provides the presentation layer only.

## Documentation

See the full docs at [crustjs.com](https://crustjs.com).

## License

MIT
