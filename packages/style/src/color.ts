// ────────────────────────────────────────────────────────────────────────────
// Dynamic Colors — depth-aware `fg` / `bg` helpers powered by `Bun.color()`.
// ────────────────────────────────────────────────────────────────────────────
// `truecolor` / `256` go through `Bun.color()`; `16` uses an in-package
// quantizer (see {@link rgbToAnsi16Param}). See {@link ColorInput} for the
// accepted input surface.

import type { AnsiPair } from "./ansiCodes.ts";
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

/** Leading SGR introducer Bun emits for fg sequences — replaced for bg. */
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

/**
 * Parse `input` into an `[r, g, b]` triple via `Bun.color()`. Throws
 * `TypeError` on inputs Bun cannot parse.
 *
 * @internal
 */
function parseRgb(input: ColorInput): readonly [number, number, number] {
	const rgb = Bun.color(input, "[rgb]");
	if (rgb === null) {
		throw new TypeError(`Invalid color input: ${describeInput(input)}`);
	}
	return rgb;
}

/**
 * Quantize `[r, g, b]` to a foreground SGR parameter (`30`–`37`, `90`–`97`).
 * Same algorithm as `ansi-styles` / `chalk`: bucket each channel at 50%,
 * pack into a 3-bit base color, then add 60 for bright when the max
 * channel rounds up. Call sites add `+10` for backgrounds.
 *
 * TODO(bun#22161): drop this helper and use `Bun.color(input, "ansi-16")`
 * once https://github.com/oven-sh/bun/issues/22161 is fixed. Bun's
 * `"ansi-16"` path currently packs the palette index as a single ASCII
 * byte instead of decimal digits (e.g. index 9 → literal TAB),
 * producing malformed sequences like `"\x1b[38;5;\tm"`. Reproduced on
 * Bun 1.3.11.
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
 * Foreground SGR open sequence at `depth`. `truecolor` / `256` use
 * `Bun.color()`; `16` uses {@link rgbToAnsi16Param} — see the TODO
 * there for why we don't call `Bun.color(_, "ansi-16")`.
 *
 * @internal
 */
function fgOpen(input: ColorInput, depth: Exclude<ColorDepth, "none">): string {
	if (depth === "16") {
		const [r, g, b] = parseRgb(input);
		return `\x1b[${rgbToAnsi16Param(r, g, b)}m`;
	}
	const format = depth === "truecolor" ? "ansi-16m" : "ansi-256";
	const open = Bun.color(input, format);
	if (open === null) {
		throw new TypeError(`Invalid color input: ${describeInput(input)}`);
	}
	return open;
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
	// the bug. The validation walk is cheap (Bun.color call) and the
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
 * bg("info", "hsl(210, 100%, 50%)");
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
