// ────────────────────────────────────────────────────────────────────────────
// Runtime Exports — Top-level color/modifier helpers
// ────────────────────────────────────────────────────────────────────────────

import { bg as directBg, fg as directFg } from "./color.ts";
import { style } from "./createStyle.ts";
import type { ChainableStyleFn, ColorDepth, ColorInput, StyleInstance } from "./types.ts";

export const black: ChainableStyleFn = style.black;
export const red: ChainableStyleFn = style.red;
export const green: ChainableStyleFn = style.green;
export const yellow: ChainableStyleFn = style.yellow;
export const blue: ChainableStyleFn = style.blue;
export const magenta: ChainableStyleFn = style.magenta;
export const cyan: ChainableStyleFn = style.cyan;
export const white: ChainableStyleFn = style.white;
export const gray: ChainableStyleFn = style.gray;
export const brightRed: ChainableStyleFn = style.brightRed;
export const brightGreen: ChainableStyleFn = style.brightGreen;
export const brightYellow: ChainableStyleFn = style.brightYellow;
export const brightBlue: ChainableStyleFn = style.brightBlue;
export const brightMagenta: ChainableStyleFn = style.brightMagenta;
export const brightCyan: ChainableStyleFn = style.brightCyan;
export const brightWhite: ChainableStyleFn = style.brightWhite;
export const bgBlack: ChainableStyleFn = style.bgBlack;
export const bgRed: ChainableStyleFn = style.bgRed;
export const bgGreen: ChainableStyleFn = style.bgGreen;
export const bgYellow: ChainableStyleFn = style.bgYellow;
export const bgBlue: ChainableStyleFn = style.bgBlue;
export const bgMagenta: ChainableStyleFn = style.bgMagenta;
export const bgCyan: ChainableStyleFn = style.bgCyan;
export const bgWhite: ChainableStyleFn = style.bgWhite;
export const bgBrightBlack: ChainableStyleFn = style.bgBrightBlack;
export const bgBrightRed: ChainableStyleFn = style.bgBrightRed;
export const bgBrightGreen: ChainableStyleFn = style.bgBrightGreen;
export const bgBrightYellow: ChainableStyleFn = style.bgBrightYellow;
export const bgBrightBlue: ChainableStyleFn = style.bgBrightBlue;
export const bgBrightMagenta: ChainableStyleFn = style.bgBrightMagenta;
export const bgBrightCyan: ChainableStyleFn = style.bgBrightCyan;
export const bgBrightWhite: ChainableStyleFn = style.bgBrightWhite;
export const bold: ChainableStyleFn = style.bold;
export const dim: ChainableStyleFn = style.dim;
export const italic: ChainableStyleFn = style.italic;
export const underline: ChainableStyleFn = style.underline;
export const inverse: ChainableStyleFn = style.inverse;
export const hidden: ChainableStyleFn = style.hidden;
export const strikethrough: ChainableStyleFn = style.strikethrough;
export const link: StyleInstance["link"] = style.link;

/**
 * Apply a foreground color to `text`.
 *
 * Resolves the active color depth from the runtime style facade (respecting
 * `NO_COLOR`, `FORCE_COLOR`, and TTY detection) and emits the matching
 * `Bun.color()` format — truecolor, 256, 16, or none.
 *
 * @param text - The string to style. Empty input returns `""` after
 *   validating `input` (so invalid colors still throw).
 * @param input - Any {@link ColorInput} (named CSS color, hex, `rgb()`,
 *   `hsl()`, tuple, object, or packed number).
 * @param depth - Optional override for the resolved color depth. When
 *   omitted, depth comes from the runtime style. Useful for deterministic
 *   output (e.g. tests, snapshots).
 * @returns The styled string with appropriate ANSI escape sequences.
 * @throws {TypeError} If `input` is not a recognized color.
 *
 * @example
 * ```ts
 * fg("error", "#ff0000");
 * fg("name", "rebeccapurple");
 * fg("deterministic", "#ff8800", "256"); // force 256-color
 * ```
 */
export function fg(text: string, input: ColorInput, depth?: ColorDepth): string {
	return depth === undefined ? style.fg(text, input) : directFg(text, input, depth);
}

/**
 * Apply a background color to `text`. Mirrors {@link fg} — see there for
 * details on `depth`, validation, and capability detection.
 *
 * @example
 * ```ts
 * bg("warning", "#ff8800");
 * bg("info", "hsl(210, 100%, 50%)", "16"); // force 16-color fallback
 * ```
 */
export function bg(text: string, input: ColorInput, depth?: ColorDepth): string {
	return depth === undefined ? style.bg(text, input) : directBg(text, input, depth);
}
