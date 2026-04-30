// ────────────────────────────────────────────────────────────────────────────
// Dynamic Colors — DEPRECATED truecolor RGB and hex helpers
// ────────────────────────────────────────────────────────────────────────────
//
// Superseded by the depth-aware `fg` / `bg` (and `fgCode` / `bgCode`)
// helpers in `./color.ts`. Every export here is `@deprecated` and will be
// removed in a future major release. The implementations are unchanged so
// existing call sites keep their original behavior — including the
// `RangeError` on out-of-range RGB channels and the `TypeError` on
// malformed hex strings — until they migrate.

import type { AnsiPair } from "./ansiCodes.ts";
import { applyStyle } from "./styleEngine.ts";

// ────────────────────────────────────────────────────────────────────────────
// Validation
// ────────────────────────────────────────────────────────────────────────────

/**
 * Validate that an RGB channel value is an integer in the range 0–255.
 *
 * @throws {RangeError} If the value is not an integer or is outside 0–255.
 * @internal
 */
function validateChannel(value: number, channel: string): void {
	if (!Number.isInteger(value) || value < 0 || value > 255) {
		throw new RangeError(
			`Invalid ${channel} value: ${String(value)}. Must be an integer between 0 and 255.`,
		);
	}
}

/**
 * Validate all three RGB channels.
 *
 * @throws {RangeError} If any channel value is invalid.
 * @internal
 */
function validateRgb(r: number, g: number, b: number): void {
	validateChannel(r, "red");
	validateChannel(g, "green");
	validateChannel(b, "blue");
}

// ────────────────────────────────────────────────────────────────────────────
// Hex Parsing
// ────────────────────────────────────────────────────────────────────────────

/** Pattern for 3-digit hex: `#RGB` */
const HEX_SHORT = /^#([0-9a-f]{3})$/i;
/** Pattern for 6-digit hex: `#RRGGBB` */
const HEX_LONG = /^#([0-9a-f]{6})$/i;

/**
 * Parse a hex color string into RGB channel values.
 *
 * Supports `#RGB` (shorthand) and `#RRGGBB` (full) formats.
 * The `#` prefix is required.
 *
 * @param hex - The hex color string.
 * @returns A tuple of `[r, g, b]` channel values (0–255).
 * @throws {TypeError} If the string is not a valid hex color.
 *
 * @deprecated `Bun.color()` parses every hex form this helper accepts.
 * Pass the hex string directly to `fg` / `bg` / `fgCode` / `bgCode`
 * instead.
 *
 * @example
 * ```ts
 * parseHex("#ff0000"); // [255, 0, 0]
 * parseHex("#f00");    // [255, 0, 0]
 * ```
 */
export function parseHex(hex: string): [r: number, g: number, b: number] {
	const shortMatch = HEX_SHORT.exec(hex);
	if (shortMatch) {
		const digits = shortMatch[1] as string;
		const r = digits.charAt(0);
		const g = digits.charAt(1);
		const b = digits.charAt(2);
		return [
			Number.parseInt(r + r, 16),
			Number.parseInt(g + g, 16),
			Number.parseInt(b + b, 16),
		];
	}

	const longMatch = HEX_LONG.exec(hex);
	if (longMatch) {
		const digits = longMatch[1] as string;
		return [
			Number.parseInt(digits.slice(0, 2), 16),
			Number.parseInt(digits.slice(2, 4), 16),
			Number.parseInt(digits.slice(4, 6), 16),
		];
	}

	throw new TypeError(
		`Invalid hex color: "${hex}". Expected format: "#RGB" or "#RRGGBB".`,
	);
}

// ────────────────────────────────────────────────────────────────────────────
// ANSI Pair Factories
// ────────────────────────────────────────────────────────────────────────────

/**
 * Create an {@link AnsiPair} for a truecolor foreground RGB color.
 *
 * Uses the ANSI escape sequence `\x1b[38;2;R;G;Bm` with close `\x1b[39m`.
 *
 * @param r - Red channel (0–255).
 * @param g - Green channel (0–255).
 * @param b - Blue channel (0–255).
 * @returns An ANSI pair for the specified foreground color.
 * @throws {RangeError} If any channel value is invalid.
 *
 * @deprecated Use `fgCode([r, g, b])` from `./color.ts` instead.
 *
 * @example
 * ```ts
 * const pair = rgbCode(255, 0, 0);
 * applyStyle("error", pair); // red foreground
 * ```
 */
export function rgbCode(r: number, g: number, b: number): AnsiPair {
	validateRgb(r, g, b);
	return { open: `\x1b[38;2;${r};${g};${b}m`, close: "\x1b[39m" };
}

/**
 * Create an {@link AnsiPair} for a truecolor background RGB color.
 *
 * Uses the ANSI escape sequence `\x1b[48;2;R;G;Bm` with close `\x1b[49m`.
 *
 * @param r - Red channel (0–255).
 * @param g - Green channel (0–255).
 * @param b - Blue channel (0–255).
 * @returns An ANSI pair for the specified background color.
 * @throws {RangeError} If any channel value is invalid.
 *
 * @deprecated Use `bgCode([r, g, b])` from `./color.ts` instead.
 *
 * @example
 * ```ts
 * const pair = bgRgbCode(255, 128, 0);
 * applyStyle("warning", pair); // orange background
 * ```
 */
export function bgRgbCode(r: number, g: number, b: number): AnsiPair {
	validateRgb(r, g, b);
	return { open: `\x1b[48;2;${r};${g};${b}m`, close: "\x1b[49m" };
}

/**
 * Create an {@link AnsiPair} for a truecolor foreground hex color.
 *
 * @param hex - Hex color string (`#RGB` or `#RRGGBB`).
 * @returns An ANSI pair for the specified foreground color.
 * @throws {TypeError} If the hex string is invalid.
 *
 * @deprecated Use `fgCode("#rrggbb")` from `./color.ts` instead.
 *
 * @example
 * ```ts
 * const pair = hexCode("#ff0000");
 * applyStyle("error", pair); // red foreground
 * ```
 */
export function hexCode(hex: string): AnsiPair {
	const [r, g, b] = parseHex(hex);
	return rgbCode(r, g, b);
}

/**
 * Create an {@link AnsiPair} for a truecolor background hex color.
 *
 * @param hex - Hex color string (`#RGB` or `#RRGGBB`).
 * @returns An ANSI pair for the specified background color.
 * @throws {TypeError} If the hex string is invalid.
 *
 * @deprecated Use `bgCode("#rrggbb")` from `./color.ts` instead.
 *
 * @example
 * ```ts
 * const pair = bgHexCode("#ff8800");
 * applyStyle("warning", pair); // orange background
 * ```
 */
export function bgHexCode(hex: string): AnsiPair {
	const [r, g, b] = parseHex(hex);
	return bgRgbCode(r, g, b);
}

// ────────────────────────────────────────────────────────────────────────────
// Direct Styling Functions
// ────────────────────────────────────────────────────────────────────────────

/**
 * Apply a truecolor foreground RGB color to text.
 *
 * @param text - The text to style.
 * @param r - Red channel (0–255).
 * @param g - Green channel (0–255).
 * @param b - Blue channel (0–255).
 * @returns The styled string.
 * @throws {RangeError} If any channel value is invalid.
 *
 * @deprecated Use `fg(text, [r, g, b])` from `./color.ts` instead.
 *
 * @example
 * ```ts
 * rgb("error", 255, 0, 0);   // red text
 * rgb("ocean", 0, 128, 255); // blue text
 * ```
 */
export function rgb(text: string, r: number, g: number, b: number): string {
	return applyStyle(text, rgbCode(r, g, b));
}

/**
 * Apply a truecolor background RGB color to text.
 *
 * @param text - The text to style.
 * @param r - Red channel (0–255).
 * @param g - Green channel (0–255).
 * @param b - Blue channel (0–255).
 * @returns The styled string.
 * @throws {RangeError} If any channel value is invalid.
 *
 * @deprecated Use `bg(text, [r, g, b])` from `./color.ts` instead.
 *
 * @example
 * ```ts
 * bgRgb("warning", 255, 128, 0); // orange background
 * ```
 */
export function bgRgb(text: string, r: number, g: number, b: number): string {
	return applyStyle(text, bgRgbCode(r, g, b));
}

/**
 * Apply a truecolor foreground hex color to text.
 *
 * @param text - The text to style.
 * @param hexColor - Hex color string (`#RGB` or `#RRGGBB`).
 * @returns The styled string.
 * @throws {TypeError} If the hex string is invalid.
 *
 * @deprecated Use `fg(text, "#rrggbb")` from `./color.ts` instead.
 *
 * @example
 * ```ts
 * hex("error", "#ff0000");   // red text
 * hex("ocean", "#0080ff");   // blue text
 * hex("short", "#f00");      // red text (shorthand)
 * ```
 */
export function hex(text: string, hexColor: string): string {
	return applyStyle(text, hexCode(hexColor));
}

/**
 * Apply a truecolor background hex color to text.
 *
 * @param text - The text to style.
 * @param hexColor - Hex color string (`#RGB` or `#RRGGBB`).
 * @returns The styled string.
 * @throws {TypeError} If the hex string is invalid.
 *
 * @deprecated Use `bg(text, "#rrggbb")` from `./color.ts` instead.
 *
 * @example
 * ```ts
 * bgHex("warning", "#ff8800"); // orange background
 * ```
 */
export function bgHex(text: string, hexColor: string): string {
	return applyStyle(text, bgHexCode(hexColor));
}
