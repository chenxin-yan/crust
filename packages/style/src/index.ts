// ────────────────────────────────────────────────────────────────────────────
// @crustjs/style — Terminal styling foundation for Crust
// ────────────────────────────────────────────────────────────────────────────

// ANSI codes
export type { AnsiPair } from "./ansiCodes.ts";
// Block helpers
export type {
	OrderedListOptions,
	TaskListItem,
	TaskListOptions,
	UnorderedListOptions,
} from "./blocks/lists.ts";
export { orderedList, taskList, unorderedList } from "./blocks/lists.ts";
export type { ColumnAlignment, TableOptions } from "./blocks/tables.ts";
export { table } from "./blocks/tables.ts";
export { resolveColorDepth } from "./capability.ts";
// Style primitives — Dynamic colors (depth-aware) powered by `Bun.color()`
export { bgCode, fgCode } from "./color.ts";
export { createStyle, getGlobalColorMode, setGlobalColorMode, style } from "./createStyle.ts";
export type { HyperlinkOptions } from "./hyperlinks.ts";
export { linkCode } from "./hyperlinks.ts";
export type { NamedColor } from "./namedColors.ts";
export {
	bg,
	// Background
	bgBlack,
	bgBlue,
	bgBrightBlack,
	bgBrightBlue,
	bgBrightCyan,
	bgBrightGreen,
	bgBrightMagenta,
	bgBrightRed,
	bgBrightWhite,
	bgBrightYellow,
	bgCyan,
	bgGreen,
	bgMagenta,
	bgRed,
	bgWhite,
	bgYellow,
	// Foreground
	black,
	blue,
	// Modifiers
	bold,
	brightBlue,
	brightCyan,
	brightGreen,
	brightMagenta,
	brightRed,
	brightWhite,
	brightYellow,
	cyan,
	dim,
	fg,
	gray,
	green,
	hidden,
	inverse,
	italic,
	link,
	magenta,
	red,
	strikethrough,
	underline,
	white,
	yellow,
} from "./runtimeExports.ts";
// Style engine
export { applyStyle, composeStyles } from "./styleEngine.ts";
export { center, padEnd, padStart } from "./text/pad.ts";
// Text utilities
export { visibleWidth } from "./text/width.ts";
export type { WrapOptions } from "./text/wrap.ts";
export { wrapText } from "./text/wrap.ts";
// Markdown theme
export type { CreateMarkdownThemeOptions } from "./theme/createMarkdownTheme.ts";
export { createMarkdownTheme, defaultTheme } from "./theme/createMarkdownTheme.ts";
export type { MarkdownTheme, PartialMarkdownTheme, ThemeSlotFn } from "./theme/markdownTheme.ts";
// Capability detection
export type {
	CapabilityOverrides,
	CheckedColorInput,
	ColorDepth,
	ColorInput,
	ColorInputCandidate,
	ColorMode,
	ColorString,
	CssColorFunctionString,
	NonStringColorInput,
	StrictColorString,
	StyleFn,
	StyleInstance,
	StyleOptions,
} from "./types.ts";
