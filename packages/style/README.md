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

```ts
import { applyStyle, composeStyles, boldCode, redCode } from "@crustjs/style";

const boldRed = composeStyles(boldCode, redCode);
console.log(applyStyle("critical error", boldRed));
```

Nested styles are handled safely — no style bleed across boundaries.

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

## Dynamic Colors (Truecolor)

Use any RGB or hex color via 24-bit truecolor ANSI sequences:

```ts
import { rgb, bgRgb, hex, bgHex } from "@crustjs/style";

// RGB values (0–255)
console.log(rgb("ocean", 0, 128, 255));
console.log(bgRgb("warning", 255, 128, 0));

// Hex colors (#RGB or #RRGGBB)
console.log(hex("error", "#ff0000"));
console.log(hex("short", "#f00"));
console.log(bgHex("highlight", "#ff8800"));
```

### Pair Factories

Create reusable `AnsiPair` objects for composition:

```ts
import { rgbCode, bgRgbCode, hexCode, bgHexCode, applyStyle, composeStyles, boldCode } from "@crustjs/style";

const coral = rgbCode(255, 127, 80);
console.log(applyStyle("coral text", coral));

const boldCoral = composeStyles(boldCode, hexCode("#ff7f50"));
console.log(applyStyle("bold coral", boldCoral));
```

### Style Instance

Dynamic colors on `createStyle` instances respect mode and truecolor detection:

```ts
import { createStyle } from "@crustjs/style";

const s = createStyle({ mode: "always" });
console.log(s.rgb("text", 255, 0, 0));
console.log(s.hex("text", "#ff0000"));
console.log(s.bgRgb("text", 0, 128, 255));
console.log(s.bgHex("text", "#0080ff"));
```

In `"auto"` mode, dynamic colors are emitted only when the terminal supports truecolor (detected via `COLORTERM=truecolor|24bit` or `TERM` containing `truecolor`, `24bit`, or `-direct`). When truecolor is not detected, dynamic color methods return plain text while standard 16-color methods continue to work.

In `"never"` mode, all dynamic color methods return plain text. In `"always"` mode, truecolor sequences are always emitted.

### Terminal Compatibility

Dynamic colors use truecolor (24-bit) ANSI sequences. There is no automatic fallback to 256 or 16 colors. On terminals that do not support truecolor:

- Colors may be approximated to the nearest supported color
- Colors may be silently ignored (text renders in default color)
- No runtime errors will occur

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

// Turn colors off while keeping bold/italic/hyperlinks/etc.
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
