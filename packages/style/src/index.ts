// ────────────────────────────────────────────────────────────────────────────
// @crustjs/style — Terminal styling foundation for Crust
// ────────────────────────────────────────────────────────────────────────────

// ANSI codes
export type { AnsiPair } from "./ansiCodes.ts";
// Block helpers
export type { ColumnAlignment, TableOptions } from "./blocks/tables.ts";
export { table } from "./blocks/tables.ts";
export { createStyle, style } from "./createStyle.ts";
export type { HyperlinkOptions } from "./hyperlinks.ts";
export type { NamedColor } from "./namedColorValues.ts";
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
// Text utilities
export { stringWidth } from "./stringWidth.ts";
export { center, padEnd, padStart } from "./text/pad.ts";
// Capability detection
export type {
	CapabilityOverrides,
	ColorDepth,
	ColorInput,
	ColorMode,
	ColorString,
	StyleFn,
	StyleInstance,
	StyleOptions,
} from "./types.ts";
