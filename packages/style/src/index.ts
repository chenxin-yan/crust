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
export { resolveCapability } from "./capability.ts";
// Style primitives — Colors
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
	bgMagenta,
	bgRed,
	bgWhite,
	bgYellow,
	// Foreground
	black,
	blue,
	brightBlue,
	brightCyan,
	brightGreen,
	brightMagenta,
	brightRed,
	brightWhite,
	brightYellow,
	cyan,
	gray,
	green,
	magenta,
	red,
	white,
	yellow,
} from "./colors.ts";
export { createStyle, style } from "./createStyle.ts";
// Style primitives — Modifiers
export {
	bold,
	dim,
	hidden,
	inverse,
	italic,
	strikethrough,
	underline,
} from "./modifiers.ts";
// Style engine
export { applyStyle, composeStyles } from "./styleEngine.ts";
// Capability detection
export type {
	CapabilityOverrides,
	ColorMode,
	StyleFn,
	StyleInstance,
	StyleOptions,
} from "./types.ts";

// Text utilities
// export { stripAnsi } from "./text/stripAnsi.ts";
// export { visibleWidth } from "./text/width.ts";
// export { wrapText } from "./text/wrap.ts";
// export { padStart, padEnd, center } from "./text/pad.ts";

// Block helpers
// export { unorderedList, orderedList, taskList } from "./blocks/lists.ts";
// export { table } from "./blocks/tables.ts";

// Markdown theme
// export type { MarkdownTheme } from "./theme/markdownTheme.ts";
// export { defaultTheme } from "./theme/defaultTheme.ts";
// export { createTheme } from "./theme/createTheme.ts";
