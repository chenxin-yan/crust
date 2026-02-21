// ────────────────────────────────────────────────────────────────────────────
// Create Style — Configurable style instance factory
// ────────────────────────────────────────────────────────────────────────────

import type { AnsiPair } from "./ansiCodes.ts";
import * as codes from "./ansiCodes.ts";
import { resolveCapability } from "./capability.ts";
import { applyStyle } from "./styleEngine.ts";
import type { StyleInstance, StyleOptions } from "./types.ts";

/**
 * Create a mode-aware style function from an ANSI pair.
 *
 * When `enabled` is `false`, returns the input text unchanged (plain text).
 * When `enabled` is `true`, delegates to `applyStyle` for ANSI emission.
 */
function makeStyleFn(pair: AnsiPair, enabled: boolean) {
	if (enabled) {
		return (text: string) => applyStyle(text, pair);
	}
	return (text: string) => text;
}

/**
 * Create a configured style instance with mode-aware styling functions.
 *
 * The returned instance provides the full set of modifier, foreground color,
 * and background color functions. In `"never"` mode (or when `"auto"` mode
 * resolves to disabled), all functions return plain text without ANSI codes.
 * In `"always"` mode (or when `"auto"` resolves to enabled), ANSI codes are
 * emitted via the nesting-safe style engine.
 *
 * @param options - Configuration options. Defaults to `{ mode: "auto" }`.
 * @returns A frozen {@link StyleInstance} with all styling functions.
 *
 * @example
 * ```ts
 * // Auto-detect terminal capabilities
 * const s = createStyle();
 * console.log(s.bold("hello"));
 *
 * // Force color output
 * const color = createStyle({ mode: "always" });
 * console.log(color.red("error"));
 *
 * // Disable all styling
 * const plain = createStyle({ mode: "never" });
 * console.log(plain.red("error")); // "error"
 *
 * // Deterministic testing
 * const test = createStyle({
 *   mode: "auto",
 *   overrides: { isTTY: true, noColor: undefined },
 * });
 * ```
 */
export function createStyle(options?: StyleOptions): StyleInstance {
	const mode = options?.mode ?? "auto";
	const enabled = resolveCapability(mode, options?.overrides);

	const instance: StyleInstance = {
		enabled,

		// ── Style engine ────────────────────────────────────────────────────

		apply: enabled
			? (text: string, pair: AnsiPair) => applyStyle(text, pair)
			: (text: string, _pair: AnsiPair) => text,

		// ── Modifiers ───────────────────────────────────────────────────────

		bold: makeStyleFn(codes.bold, enabled),
		dim: makeStyleFn(codes.dim, enabled),
		italic: makeStyleFn(codes.italic, enabled),
		underline: makeStyleFn(codes.underline, enabled),
		inverse: makeStyleFn(codes.inverse, enabled),
		hidden: makeStyleFn(codes.hidden, enabled),
		strikethrough: makeStyleFn(codes.strikethrough, enabled),

		// ── Foreground colors ───────────────────────────────────────────────

		black: makeStyleFn(codes.black, enabled),
		red: makeStyleFn(codes.red, enabled),
		green: makeStyleFn(codes.green, enabled),
		yellow: makeStyleFn(codes.yellow, enabled),
		blue: makeStyleFn(codes.blue, enabled),
		magenta: makeStyleFn(codes.magenta, enabled),
		cyan: makeStyleFn(codes.cyan, enabled),
		white: makeStyleFn(codes.white, enabled),
		gray: makeStyleFn(codes.gray, enabled),
		brightRed: makeStyleFn(codes.brightRed, enabled),
		brightGreen: makeStyleFn(codes.brightGreen, enabled),
		brightYellow: makeStyleFn(codes.brightYellow, enabled),
		brightBlue: makeStyleFn(codes.brightBlue, enabled),
		brightMagenta: makeStyleFn(codes.brightMagenta, enabled),
		brightCyan: makeStyleFn(codes.brightCyan, enabled),
		brightWhite: makeStyleFn(codes.brightWhite, enabled),

		// ── Background colors ───────────────────────────────────────────────

		bgBlack: makeStyleFn(codes.bgBlack, enabled),
		bgRed: makeStyleFn(codes.bgRed, enabled),
		bgGreen: makeStyleFn(codes.bgGreen, enabled),
		bgYellow: makeStyleFn(codes.bgYellow, enabled),
		bgBlue: makeStyleFn(codes.bgBlue, enabled),
		bgMagenta: makeStyleFn(codes.bgMagenta, enabled),
		bgCyan: makeStyleFn(codes.bgCyan, enabled),
		bgWhite: makeStyleFn(codes.bgWhite, enabled),
		bgBrightBlack: makeStyleFn(codes.bgBrightBlack, enabled),
		bgBrightRed: makeStyleFn(codes.bgBrightRed, enabled),
		bgBrightGreen: makeStyleFn(codes.bgBrightGreen, enabled),
		bgBrightYellow: makeStyleFn(codes.bgBrightYellow, enabled),
		bgBrightBlue: makeStyleFn(codes.bgBrightBlue, enabled),
		bgBrightMagenta: makeStyleFn(codes.bgBrightMagenta, enabled),
		bgBrightCyan: makeStyleFn(codes.bgBrightCyan, enabled),
		bgBrightWhite: makeStyleFn(codes.bgBrightWhite, enabled),
	};

	return Object.freeze(instance);
}

/**
 * Default style instance using `"auto"` mode.
 *
 * Emits ANSI codes when stdout is a TTY and `NO_COLOR` is not set.
 * Import this for convenient access without explicit configuration.
 *
 * @example
 * ```ts
 * import { style } from "@crustjs/style";
 *
 * console.log(style.bold("hello"));
 * console.log(style.red("error"));
 * ```
 */
export const style: StyleInstance = createStyle();
