// ────────────────────────────────────────────────────────────────────────────
// @crustjs/style — Terminal styling foundation for Crust
// ────────────────────────────────────────────────────────────────────────────

// ANSI codes
export type { AnsiPair } from "./ansiCodes.ts";
export {
	// Background colors
	bgBlack as bgBlackCode,
	bgBlue as bgBlueCode,
	bgBrightBlack as bgBrightBlackCode,
	bgBrightBlue as bgBrightBlueCode,
	bgBrightCyan as bgBrightCyanCode,
	bgBrightGreen as bgBrightGreenCode,
	bgBrightMagenta as bgBrightMagentaCode,
	bgBrightRed as bgBrightRedCode,
	bgBrightWhite as bgBrightWhiteCode,
	bgBrightYellow as bgBrightYellowCode,
	bgCyan as bgCyanCode,
	bgGreen as bgGreenCode,
	bgMagenta as bgMagentaCode,
	bgRed as bgRedCode,
	bgWhite as bgWhiteCode,
	bgYellow as bgYellowCode,
	// Foreground colors
	black as blackCode,
	blue as blueCode,
	bold as boldCode,
	brightBlue as brightBlueCode,
	brightCyan as brightCyanCode,
	brightGreen as brightGreenCode,
	brightMagenta as brightMagentaCode,
	brightRed as brightRedCode,
	brightWhite as brightWhiteCode,
	brightYellow as brightYellowCode,
	cyan as cyanCode,
	dim as dimCode,
	gray as grayCode,
	green as greenCode,
	hidden as hiddenCode,
	inverse as inverseCode,
	italic as italicCode,
	magenta as magentaCode,
	red as redCode,
	// Modifiers
	reset,
	strikethrough as strikethroughCode,
	underline as underlineCode,
	white as whiteCode,
	yellow as yellowCode,
} from "./ansiCodes.ts";
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
export {
	resolveColorCapability,
	resolveHyperlinkCapability,
	resolveTrueColorCapability,
} from "./capability.ts";
export {
	createStyle,
	getGlobalColorMode,
	setGlobalColorMode,
	style,
} from "./createStyle.ts";
// Style primitives — Dynamic colors (truecolor)
export {
	bgHexCode,
	bgRgbCode,
	hexCode,
	parseHex,
	rgbCode,
} from "./dynamicColors.ts";
export type { HyperlinkOptions } from "./hyperlinks.ts";
export { linkCode } from "./hyperlinks.ts";
export {
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
	bgHex,
	bgMagenta,
	bgRed,
	bgRgb,
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
	gray,
	green,
	hex,
	hidden,
	inverse,
	italic,
	link,
	magenta,
	red,
	rgb,
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
export {
	createMarkdownTheme,
	defaultTheme,
} from "./theme/createMarkdownTheme.ts";
export type {
	MarkdownTheme,
	PartialMarkdownTheme,
	ThemeSlotFn,
} from "./theme/markdownTheme.ts";
export { buildDefaultMarkdownTheme } from "./theme/markdownTheme.ts";
// Capability detection
export type {
	CapabilityOverrides,
	ColorMode,
	StyleFn,
	StyleInstance,
	StyleOptions,
	TrueColorOverrides,
} from "./types.ts";
