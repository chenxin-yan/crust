// ────────────────────────────────────────────────────────────────────────────
// Dynamic Colors — Depth-aware helpers powered by `Bun.color()`
// ────────────────────────────────────────────────────────────────────────────
//
// One canonical foreground / background pair driven by Bun's built-in color
// parser. Accepts any input `Bun.color()` understands: hex (3/6/8 digit),
// named CSS colors (`"red"`, `"rebeccapurple"`), `rgb()` / `rgba()` strings,
// `hsl()` / `hsla()` strings, `lab()` strings, numeric (`0xff0000`),
// `{ r, g, b, a? }` objects, and `[r, g, b]` / `[r, g, b, a]` arrays.
//
// At call time these helpers fall back to a coarser `Bun.color()` format
// when the resolved {@link ColorDepth} is `"256"` or `"16"`, mirroring how
// `style.fg` / `style.bg` honor the terminal's capability.
//
// See https://bun.com/docs/runtime/color for the full input surface.

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

/**
 * Render `input` for inclusion in error messages. Strings are quoted (matching
 * the previous `parseHex` error-message style); everything else falls back to
 * `String(...)` with a `JSON.stringify` attempt for objects so error text stays
 * readable.
 */
function describeInput(input: unknown): string {
	if (typeof input === "string") {
		return JSON.stringify(input);
	}
	if (input !== null && typeof input === "object") {
		try {
			return JSON.stringify(input);
		} catch {
			return String(input);
		}
	}
	return String(input);
}

/**
 * Map a non-`"none"` {@link ColorDepth} to the matching `Bun.color()` format
 * string.
 */
function bunFormatFor(
	depth: Exclude<ColorDepth, "none">,
): "ansi-16m" | "ansi-256" | "ansi-16" {
	if (depth === "truecolor") {
		return "ansi-16m";
	}
	if (depth === "256") {
		return "ansi-256";
	}
	return "ansi-16";
}

/**
 * Parse `input` into a foreground ANSI open sequence at the requested depth
 * via `Bun.color()`. Throws `TypeError` on inputs Bun cannot parse.
 *
 * @internal
 */
function fgOpen(input: ColorInput, depth: Exclude<ColorDepth, "none">): string {
	const open = Bun.color(
		input as Parameters<typeof Bun.color>[0],
		bunFormatFor(depth),
	);
	if (open === null) {
		throw new TypeError(`Invalid color input: ${describeInput(input)}`);
	}
	return open;
}

// ────────────────────────────────────────────────────────────────────────────
// AnsiPair factories
// ────────────────────────────────────────────────────────────────────────────

/**
 * Create an {@link AnsiPair} for a truecolor foreground from any input
 * `Bun.color()` accepts.
 *
 * The pair's `close` is `\x1b[39m`, matching the close of every static
 * foreground color in {@link ./ansiCodes.ts} so nesting and `composeStyles`
 * behave identically to the 16-color helpers.
 *
 * Pair factories are deterministic primitives: they always emit `ansi-16m`
 * regardless of resolved capability so they remain safe to cache and
 * compose. Capability gating happens at apply time on
 * {@link StyleInstance.fg} / {@link StyleInstance.bg}.
 *
 * @throws {TypeError} If `input` is not a recognized color.
 *
 * @example
 * ```ts
 * fgCode("#ff0000");           // { open: "\x1b[38;2;255;0;0m",  close: "\x1b[39m" }
 * fgCode("rebeccapurple");     // { open: "\x1b[38;2;102;51;153m", close: "\x1b[39m" }
 * fgCode([0, 128, 255]);       // { open: "\x1b[38;2;0;128;255m", close: "\x1b[39m" }
 * fgCode({ r: 255, g: 0, b: 0 });
 * ```
 */
export function fgCode(input: ColorInput): AnsiPair {
	return { open: fgOpen(input, "truecolor"), close: FG_CLOSE };
}

/**
 * Create an {@link AnsiPair} for a truecolor background from any input
 * `Bun.color()` accepts.
 *
 * Derived from the foreground sequence by swapping the leading `38;` SGR
 * introducer for `48;`. The pair's `close` is `\x1b[49m`, matching every
 * static background color in {@link ./ansiCodes.ts}.
 *
 * Pair factories are deterministic primitives: they always emit `ansi-16m`
 * regardless of resolved capability so they remain safe to cache and
 * compose.
 *
 * @throws {TypeError} If `input` is not a recognized color.
 *
 * @example
 * ```ts
 * bgCode("#ff8800");
 * bgCode("hsl(120, 100%, 50%)");
 * bgCode(0x0080ff);
 * ```
 */
export function bgCode(input: ColorInput): AnsiPair {
	const fg = fgOpen(input, "truecolor");
	// Bun emits the `\x1b[38;` SGR introducer for every supported `ansi-*`
	// fg format. Replace the leading occurrence with `\x1b[48;` to convert
	// fg → bg.
	const open = fg.startsWith(FG_INTRODUCER)
		? BG_INTRODUCER + fg.slice(FG_INTRODUCER.length)
		: fg.replace(FG_INTRODUCER, BG_INTRODUCER);
	return { open, close: BG_CLOSE };
}

// ────────────────────────────────────────────────────────────────────────────
// Direct styling functions
// ────────────────────────────────────────────────────────────────────────────

/**
 * Apply a foreground color to `text` from any color input `Bun.color()`
 * accepts (hex, named CSS colors, `rgb()`, `hsl()`, numeric,
 * `{ r, g, b, a? }` objects, `[r, g, b]` / `[r, g, b, a]` arrays).
 *
 * The optional `depth` parameter selects the `Bun.color()` format:
 *
 * - `"truecolor"` (default) → `ansi-16m` 24-bit sequence
 * - `"256"` → `ansi-256` extended-palette sequence
 * - `"16"` → `ansi-16` standard-palette sequence
 * - `"none"` → returns `text` unchanged (still validates `input`)
 *
 * Empty `text` short-circuits to `""` without consulting `Bun.color()`.
 * Invalid `input` raises `TypeError` regardless of `depth` so user bugs are
 * surfaced even on no-color terminals.
 *
 * @throws {TypeError} If `input` is not a recognized color.
 *
 * @example
 * ```ts
 * fg("error",  "#ff0000");
 * fg("ocean",  "rgb(0, 128, 255)");
 * fg("warn",   "rebeccapurple");
 * fg("custom", [255, 127, 80]);
 * fg("256-only", "#ff0000", "256"); // emits `\x1b[38;5;196m...`
 * ```
 */
export function fg(
	text: string,
	input: ColorInput,
	depth: ColorDepth = "truecolor",
): string {
	if (text === "") {
		return "";
	}
	if (depth === "none") {
		// Validate input even when emission is disabled — silent non-throws on
		// invalid input would mask user bugs.
		fgOpen(input, "truecolor");
		return text;
	}
	const open = fgOpen(input, depth);
	const close = FG_CLOSE;
	return applyStyle(text, { open, close });
}

/**
 * Apply a background color to `text` from any color input `Bun.color()`
 * accepts.
 *
 * Mirrors {@link fg} for background sequences. The optional `depth`
 * parameter selects the `Bun.color()` format; `"none"` returns `text`
 * unchanged (after validating `input`).
 *
 * @throws {TypeError} If `input` is not a recognized color.
 *
 * @example
 * ```ts
 * bg("warning", "#ff8800");
 * bg("info",    "hsl(210, 100%, 50%)");
 * bg("debug",   { r: 100, g: 100, b: 100 });
 * bg("256-only", "#ff8800", "256");
 * ```
 */
export function bg(
	text: string,
	input: ColorInput,
	depth: ColorDepth = "truecolor",
): string {
	if (text === "") {
		return "";
	}
	if (depth === "none") {
		fgOpen(input, "truecolor");
		return text;
	}
	const fgEscape = fgOpen(input, depth);
	const open = fgEscape.startsWith(FG_INTRODUCER)
		? BG_INTRODUCER + fgEscape.slice(FG_INTRODUCER.length)
		: fgEscape.replace(FG_INTRODUCER, BG_INTRODUCER);
	return applyStyle(text, { open, close: BG_CLOSE });
}
