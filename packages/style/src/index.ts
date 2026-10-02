// ────────────────────────────────────────────────────────────────────────────
// @crustjs/style
// ────────────────────────────────────────────────────────────────────────────

// ANSI codes
export type { AnsiPair } from "./ansi-codes.ts";
// Block helpers
export type { ColumnAlignment, TableOptions } from "./table.ts";
export { table } from "./table.ts";
export { createStyle, style } from "./create-style.ts";
export type { HyperlinkOptions } from "./hyperlinks.ts";
export type { NamedColor } from "./named-color-values.ts";
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
} from "./runtime-exports.ts";
// Text utilities
export { stringWidth } from "./string-width.ts";
export { center, padEnd, padStart } from "./pad.ts";
// Capability detection
export type {
	CapabilityOverrides,
	ChainableStyleFn,
	ColorDepth,
	ColorInput,
	ColorMode,
	ColorString,
	StyleFn,
	StyleInput,
	StyleInstance,
	StyleOptions,
} from "./types.ts";
