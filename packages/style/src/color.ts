// ────────────────────────────────────────────────────────────────────────────
// Dynamic Colors — portable depth-aware `fg` / `bg` helpers.
// ────────────────────────────────────────────────────────────────────────────
// Inputs are intentionally limited to hex, rgb triples, and named colors.

import type { AnsiPair } from "./ansiCodes.ts";
import { namedColorValues } from "./namedColorValues.ts";
import { applyStyle } from "./styleEngine.ts";
import type { ColorDepth, ColorInput } from "./types.ts";

export type { ColorInput } from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

/** Foreground close: matches the close of every static fg color (`\x1b[39m`). */
const FG_CLOSE = "\x1b[39m";

/** Background close: matches the close of every static bg color (`\x1b[49m`). */
const BG_CLOSE = "\x1b[49m";

/** Foreground/background extended-color SGR introducers. */
const FG_INTRODUCER = "\x1b[38;";
const BG_INTRODUCER = "\x1b[48;";

// ────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────────────────────

/** Quote strings, JSON-stringify objects, fall back to `String()`. */
function describeInput(input: unknown): string {
	if (typeof input === "string" || (input !== null && typeof input === "object")) {
		try {
			return JSON.stringify(input);
		} catch {
			return String(input);
		}
	}
	return String(input);
}

/** Parse a supported color into an RGB triple. */
function parseRgb(input: ColorInput): readonly [number, number, number] {
	if (Array.isArray(input)) {
		if (
			input.length === 3 &&
			input.every((channel) => Number.isInteger(channel) && channel >= 0 && channel <= 255)
		) {
			return input as readonly [number, number, number];
		}
	} else if (typeof input === "string") {
		const value = input.toLowerCase();
		if (Object.hasOwn(namedColorValues, value)) {
			return namedColorValues[value as keyof typeof namedColorValues];
		}

		const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value)?.[1];
		if (hex) {
			const expanded =
				hex.length === 3
					? hex
							.split("")
							.map((digit) => digit + digit)
							.join("")
					: hex;
			return [0, 2, 4].map((offset) =>
				Number.parseInt(expanded.slice(offset, offset + 2), 16),
			) as unknown as readonly [number, number, number];
		}

		// Comma form and space form are matched separately so mixed separators
		// like `rgb(1, 2 3)` stay invalid.
		const rgb =
			/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/.exec(value) ??
			/^rgb\(\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})\s*\)$/.exec(value);
		if (rgb) {
			const channels = rgb.slice(1).map(Number);
			if (channels.every((channel) => channel <= 255))
				return channels as unknown as readonly [number, number, number];
		}
	}
	throw new TypeError(`Invalid color input: ${describeInput(input)}`);
}

function rgbToAnsi256(r: number, g: number, b: number): number {
	const levels = [0, 95, 135, 175, 215, 255];
	const nearest = (channel: number) =>
		levels.reduce(
			(best, value, index) =>
				Math.abs(value - channel) < Math.abs(levels[best]! - channel) ? index : best,
			0,
		);
	const [ir, ig, ib] = [nearest(r), nearest(g), nearest(b)];
	// Grayscale ramp candidate: indexes 232–255 cover 8–238 in steps of 10.
	// Clamping keeps light grays in range; comparing against the cube keeps
	// near-grays like [120, 121, 122] on the ramp instead of a distant cube entry.
	const grayIndex = Math.min(23, Math.max(0, Math.round(((r + g + b) / 3 - 8) / 10)));
	const gray = 8 + grayIndex * 10;
	const distance = (cr: number, cg: number, cb: number) =>
		(r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
	return distance(gray, gray, gray) < distance(levels[ir]!, levels[ig]!, levels[ib]!)
		? 232 + grayIndex
		: 16 + 36 * ir + 6 * ig + ib;
}

/**
 * Quantize `[r, g, b]` to a foreground SGR parameter (`30`–`37`, `90`–`97`).
 * Same algorithm as `ansi-styles` / `chalk`: bucket each channel at 50%,
 * pack into a 3-bit base color, then add 60 for bright when the max
 * channel rounds up. Call sites add `+10` for backgrounds.
 *
 * @internal
 */
function rgbToAnsi16Param(r: number, g: number, b: number): number {
	const maxChannel = Math.max(r, g, b);
	const brightnessBucket = Math.round(maxChannel / 127.5); // 0 → black, 1 → normal, 2 → bright
	if (brightnessBucket === 0) {
		return 30; // black
	}
	let ansi =
		30 + (((Math.round(b / 255) << 2) | (Math.round(g / 255) << 1) | Math.round(r / 255)) & 0b111);
	if (brightnessBucket === 2) {
		ansi += 60;
	}
	return ansi;
}

/**
 * Foreground SGR open sequence at `depth`.
 *
 * @internal
 */
function fgOpen(input: ColorInput, depth: Exclude<ColorDepth, "none">): string {
	const [r, g, b] = parseRgb(input);
	if (depth === "16") return `\x1b[${rgbToAnsi16Param(r, g, b)}m`;
	if (depth === "256") return `\x1b[38;5;${rgbToAnsi256(r, g, b)}m`;
	return `\x1b[38;2;${r};${g};${b}m`;
}

/**
 * Background SGR open sequence at `depth`. For `truecolor` / `256`,
 * derived from {@link fgOpen} by swapping the `\x1b[38;` introducer for
 * `\x1b[48;` (both Bun formats use it). For `16`, quantized directly to
 * a real background SGR.
 *
 * @internal
 */
function bgOpen(input: ColorInput, depth: Exclude<ColorDepth, "none">): string {
	if (depth === "16") {
		const [r, g, b] = parseRgb(input);
		return `\x1b[${rgbToAnsi16Param(r, g, b) + 10}m`;
	}
	return fgOpen(input, depth).replace(FG_INTRODUCER, BG_INTRODUCER);
}

// ────────────────────────────────────────────────────────────────────────────
// AnsiPair factories (internal — back the chainable `.fg()` / `.bg()`)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Depth-aware foreground `AnsiPair` for chain composition. `depth: "none"`
 * returns an empty pair (still validates input). Used by `createStyle()`
 * to back `chainable.fg(input)`.
 *
 * @throws {TypeError} If `input` is not a recognized color.
 * @internal
 */
export function fgPairAtDepth(input: ColorInput, depth: ColorDepth): AnsiPair {
	if (depth === "none") {
		fgOpen(input, "truecolor"); // validate, do not emit
		return { open: "", close: "" };
	}
	return { open: fgOpen(input, depth), close: FG_CLOSE };
}

/**
 * Depth-aware background `AnsiPair` for chain composition. Mirrors
 * {@link fgPairAtDepth}.
 *
 * @throws {TypeError} If `input` is not a recognized color.
 * @internal
 */
export function bgPairAtDepth(input: ColorInput, depth: ColorDepth): AnsiPair {
	if (depth === "none") {
		fgOpen(input, "truecolor"); // validate, do not emit
		return { open: "", close: "" };
	}
	return { open: bgOpen(input, depth), close: BG_CLOSE };
}

// ────────────────────────────────────────────────────────────────────────────
// Direct styling functions
// ────────────────────────────────────────────────────────────────────────────

/**
 * Apply a foreground color to `text` from any {@link ColorInput}. `depth`
 * selects the output format (`"truecolor"` default, `"256"`, `"16"`, or
 * `"none"`). `"none"` returns `text` unchanged but still validates
 * `input`. Empty `text` short-circuits to `""`.
 *
 * @throws {TypeError} If `input` is not a recognized color.
 *
 * @example
 * ```ts
 * fg("error", "#ff0000");
 * fg("ocean", "rgb(0, 128, 255)");
 * fg("custom", [255, 127, 80]);
 * fg("256-only", "#ff0000", "256"); // \x1b[38;5;196m...
 * ```
 */
export function fg(text: string, input: ColorInput, depth: ColorDepth = "truecolor"): string {
	// Validate the color BEFORE the empty-string short-circuit so callers
	// get TypeError on bad input regardless of `text`. Otherwise
	// `fg("", "definitely-not-a-color")` would silently return "" and mask
	// the bug. Validation is cheap and the
	// non-empty path needs the parsed open sequence anyway.
	if (depth === "none") {
		fgOpen(input, "truecolor"); // validate, do not emit
		return text === "" ? "" : text;
	}
	const open = fgOpen(input, depth);
	if (text === "") return "";
	return applyStyle(text, { open, close: FG_CLOSE });
}

/**
 * Apply a background color to `text`. Mirrors {@link fg}.
 *
 * @throws {TypeError} If `input` is not a recognized color.
 *
 * @example
 * ```ts
 * bg("warning", "#ff8800");
 * bg("info", "rgb(0, 128, 255)");
 * ```
 */
export function bg(text: string, input: ColorInput, depth: ColorDepth = "truecolor"): string {
	// See `fg` above — validate before short-circuiting on empty `text`.
	if (depth === "none") {
		fgOpen(input, "truecolor");
		return text === "" ? "" : text;
	}
	const open = bgOpen(input, depth);
	if (text === "") return "";
	return applyStyle(text, { open, close: BG_CLOSE });
}
