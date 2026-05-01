// ────────────────────────────────────────────────────────────────────────────
// Runtime Exports — Top-level color/modifier helpers
// ────────────────────────────────────────────────────────────────────────────
//
// Each helper delegates to the shared `style` facade in createStyle.ts so that
// `NO_COLOR`, `--color` / `--no-color` flags, and in-process color overrides
// (`setGlobalColorMode`) take effect on every call instead of binding once at
// import time.

import { bg as directBg, fg as directFg } from "./color.ts";
import { createForwardingChainable, style } from "./createStyle.ts";
import type { HyperlinkOptions } from "./hyperlinks.ts";
import type { ChainableStyleFn, ColorDepth, ColorInput } from "./types.ts";

// Top-level chainables share the `createForwardingChainable` helper used
// by the runtime `style` facade in `createStyle.ts`. Every call and
// chain access re-resolves the current runtime instance, so:
//
//   bold("hi")              — callable
//   bold`tagged ${value}`   — tagged template
//   bold.red.bgYellow("hi") — chainable
//   bold.fg("#ff8800")("hi") — dynamic-color extension
//   composeStyles(bold, red) — ANSI pair (open/close attached)
//   applyStyle("hi", bold)  — ANSI pair
//
// `setGlobalColorMode` flips and `NO_COLOR` are honored on every call,
// even on captured references like `const myBold = bold`.

export const black: ChainableStyleFn = createForwardingChainable("black");
export const red: ChainableStyleFn = createForwardingChainable("red");
export const green: ChainableStyleFn = createForwardingChainable("green");
export const yellow: ChainableStyleFn = createForwardingChainable("yellow");
export const blue: ChainableStyleFn = createForwardingChainable("blue");
export const magenta: ChainableStyleFn = createForwardingChainable("magenta");
export const cyan: ChainableStyleFn = createForwardingChainable("cyan");
export const white: ChainableStyleFn = createForwardingChainable("white");
export const gray: ChainableStyleFn = createForwardingChainable("gray");
export const brightRed: ChainableStyleFn =
	createForwardingChainable("brightRed");
export const brightGreen: ChainableStyleFn =
	createForwardingChainable("brightGreen");
export const brightYellow: ChainableStyleFn =
	createForwardingChainable("brightYellow");
export const brightBlue: ChainableStyleFn =
	createForwardingChainable("brightBlue");
export const brightMagenta: ChainableStyleFn =
	createForwardingChainable("brightMagenta");
export const brightCyan: ChainableStyleFn =
	createForwardingChainable("brightCyan");
export const brightWhite: ChainableStyleFn =
	createForwardingChainable("brightWhite");
export const bgBlack: ChainableStyleFn = createForwardingChainable("bgBlack");
export const bgRed: ChainableStyleFn = createForwardingChainable("bgRed");
export const bgGreen: ChainableStyleFn = createForwardingChainable("bgGreen");
export const bgYellow: ChainableStyleFn = createForwardingChainable("bgYellow");
export const bgBlue: ChainableStyleFn = createForwardingChainable("bgBlue");
export const bgMagenta: ChainableStyleFn =
	createForwardingChainable("bgMagenta");
export const bgCyan: ChainableStyleFn = createForwardingChainable("bgCyan");
export const bgWhite: ChainableStyleFn = createForwardingChainable("bgWhite");
export const bgBrightBlack: ChainableStyleFn =
	createForwardingChainable("bgBrightBlack");
export const bgBrightRed: ChainableStyleFn =
	createForwardingChainable("bgBrightRed");
export const bgBrightGreen: ChainableStyleFn =
	createForwardingChainable("bgBrightGreen");
export const bgBrightYellow: ChainableStyleFn =
	createForwardingChainable("bgBrightYellow");
export const bgBrightBlue: ChainableStyleFn =
	createForwardingChainable("bgBrightBlue");
export const bgBrightMagenta: ChainableStyleFn =
	createForwardingChainable("bgBrightMagenta");
export const bgBrightCyan: ChainableStyleFn =
	createForwardingChainable("bgBrightCyan");
export const bgBrightWhite: ChainableStyleFn =
	createForwardingChainable("bgBrightWhite");
export const bold: ChainableStyleFn = createForwardingChainable("bold");
export const dim: ChainableStyleFn = createForwardingChainable("dim");
export const italic: ChainableStyleFn = createForwardingChainable("italic");
export const underline: ChainableStyleFn =
	createForwardingChainable("underline");
export const inverse: ChainableStyleFn = createForwardingChainable("inverse");
export const hidden: ChainableStyleFn = createForwardingChainable("hidden");
export const strikethrough: ChainableStyleFn =
	createForwardingChainable("strikethrough");

export function link(
	text: string,
	url: string,
	options?: HyperlinkOptions,
): string {
	return style.link(text, url, options);
}

/**
 * Apply a foreground color to `text`.
 *
 * Resolves the active color depth from the runtime style facade (respecting
 * `setGlobalColorMode`, `NO_COLOR`, and TTY detection) and emits the matching
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
export function fg(
	text: string,
	input: ColorInput,
	depth?: ColorDepth,
): string {
	return depth === undefined
		? style.fg(text, input)
		: directFg(text, input, depth);
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
export function bg(
	text: string,
	input: ColorInput,
	depth?: ColorDepth,
): string {
	return depth === undefined
		? style.bg(text, input)
		: directBg(text, input, depth);
}

// ────────────────────────────────────────────────────────────────────────────
// Deprecated dynamic-color helpers — superseded by `fg` / `bg`.
// ────────────────────────────────────────────────────────────────────────────
//
// These delegate to `style.rgb` / `style.bgRgb` / `style.hex` / `style.bgHex`
// so they continue to honor `setGlobalColorMode`, `NO_COLOR`, and TTY
// detection. They will be removed in v1.0.0.

/**
 * @deprecated Use {@link fg | `fg(text, [r, g, b])`} instead. Will be
 * removed in v1.0.0.
 */
export function rgb(text: string, r: number, g: number, b: number): string {
	return style.rgb(text, r, g, b);
}

/**
 * @deprecated Use {@link bg | `bg(text, [r, g, b])`} instead. Will be
 * removed in v1.0.0.
 */
export function bgRgb(text: string, r: number, g: number, b: number): string {
	return style.bgRgb(text, r, g, b);
}

/**
 * @deprecated Use {@link fg | `fg(text, "#rrggbb")`} instead. Will be
 * removed in v1.0.0.
 */
export function hex(text: string, hexColor: string): string {
	return style.hex(text, hexColor);
}

/**
 * @deprecated Use {@link bg | `bg(text, "#rrggbb")`} instead. Will be
 * removed in v1.0.0.
 */
export function bgHex(text: string, hexColor: string): string {
	return style.bgHex(text, hexColor);
}
