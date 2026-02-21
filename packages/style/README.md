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
```

## Primitive Styling

Direct styling functions that always emit ANSI codes (useful when you control output directly):

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

## Color Modes

Control when ANSI codes are emitted using `createStyle`:

```ts
import { createStyle } from "@crustjs/style";

// Auto-detect (default) — respects NO_COLOR and TTY status
const auto = createStyle({ mode: "auto" });

// Always emit ANSI codes
const color = createStyle({ mode: "always" });
console.log(color.red("always red"));

// Never emit ANSI codes — returns plain text
const plain = createStyle({ mode: "never" });
console.log(plain.red("just text")); // "just text"
```

The default `style` export uses `"auto"` mode:

- Emits ANSI when stdout is a TTY and `NO_COLOR` is not set
- Returns plain text otherwise

### Deterministic Testing

Inject capability overrides for predictable test output:

```ts
const testStyle = createStyle({
  mode: "auto",
  overrides: { isTTY: true, noColor: undefined },
});
```

## Text Utilities

ANSI-aware text measurement and layout:

```ts
import {
  stripAnsi,
  visibleWidth,
  wrapText,
  padStart,
  padEnd,
  center,
} from "@crustjs/style";

// Strip ANSI escape sequences
stripAnsi("\x1b[1mhello\x1b[22m"); // "hello"

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

### Custom Themes

Override specific slots while inheriting defaults:

```ts
import { createTheme } from "@crustjs/style";

const theme = createTheme({
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
