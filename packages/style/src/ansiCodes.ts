// ────────────────────────────────────────────────────────────────────────────
// ANSI Codes — Open/close escape sequences for modifiers and colors
// ────────────────────────────────────────────────────────────────────────────

/**
 * An ANSI style pair consisting of an opening and closing escape sequence.
 *
 * @example
 * ```ts
 * const bold: AnsiPair = { open: "\x1b[1m", close: "\x1b[22m" };
 * ```
 */
export interface AnsiPair {
	readonly open: string;
	readonly close: string;
}

function pair(open: number, close: number): AnsiPair {
	return { open: `\x1b[${open}m`, close: `\x1b[${close}m` };
}

// ────────────────────────────────────────────────────────────────────────────
// Modifiers
// ────────────────────────────────────────────────────────────────────────────

/** Reset all attributes. */
export const reset: AnsiPair = pair(0, 0);

/** Bold / increased intensity. */
export const bold: AnsiPair = pair(1, 22);

/** Dim / decreased intensity. */
export const dim: AnsiPair = pair(2, 22);

/** Italic. */
export const italic: AnsiPair = pair(3, 23);

/** Underline. */
export const underline: AnsiPair = pair(4, 24);

/** Inverse / reverse video. */
export const inverse: AnsiPair = pair(7, 27);

/** Hidden / conceal. */
export const hidden: AnsiPair = pair(8, 28);

/** Strikethrough / crossed out. */
export const strikethrough: AnsiPair = pair(9, 29);

// ────────────────────────────────────────────────────────────────────────────
// Foreground Colors
// ────────────────────────────────────────────────────────────────────────────

export const black: AnsiPair = pair(30, 39);
export const red: AnsiPair = pair(31, 39);
export const green: AnsiPair = pair(32, 39);
export const yellow: AnsiPair = pair(33, 39);
export const blue: AnsiPair = pair(34, 39);
export const magenta: AnsiPair = pair(35, 39);
export const cyan: AnsiPair = pair(36, 39);
export const white: AnsiPair = pair(37, 39);

/** Bright black (gray). */
export const gray: AnsiPair = pair(90, 39);

// Bright variants
export const brightRed: AnsiPair = pair(91, 39);
export const brightGreen: AnsiPair = pair(92, 39);
export const brightYellow: AnsiPair = pair(93, 39);
export const brightBlue: AnsiPair = pair(94, 39);
export const brightMagenta: AnsiPair = pair(95, 39);
export const brightCyan: AnsiPair = pair(96, 39);
export const brightWhite: AnsiPair = pair(97, 39);

// ────────────────────────────────────────────────────────────────────────────
// Background Colors
// ────────────────────────────────────────────────────────────────────────────

export const bgBlack: AnsiPair = pair(40, 49);
export const bgRed: AnsiPair = pair(41, 49);
export const bgGreen: AnsiPair = pair(42, 49);
export const bgYellow: AnsiPair = pair(43, 49);
export const bgBlue: AnsiPair = pair(44, 49);
export const bgMagenta: AnsiPair = pair(45, 49);
export const bgCyan: AnsiPair = pair(46, 49);
export const bgWhite: AnsiPair = pair(47, 49);

// Bright background variants
export const bgBrightBlack: AnsiPair = pair(100, 49);
export const bgBrightRed: AnsiPair = pair(101, 49);
export const bgBrightGreen: AnsiPair = pair(102, 49);
export const bgBrightYellow: AnsiPair = pair(103, 49);
export const bgBrightBlue: AnsiPair = pair(104, 49);
export const bgBrightMagenta: AnsiPair = pair(105, 49);
export const bgBrightCyan: AnsiPair = pair(106, 49);
export const bgBrightWhite: AnsiPair = pair(107, 49);
