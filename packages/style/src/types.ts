// ────────────────────────────────────────────────────────────────────────────
// Types — Mode, options, and shared type definitions
// ────────────────────────────────────────────────────────────────────────────

import type { AnsiPair } from "./ansiCodes.ts";

/**
 * Color emission mode for the style engine.
 *
 * - `"auto"` — Emit ANSI codes when stdout is a TTY and `NO_COLOR` is not set.
 * - `"always"` — Always emit ANSI codes regardless of terminal detection.
 * - `"never"` — Never emit ANSI codes; return plain text.
 *
 * @example
 * ```ts
 * const style = createStyle({ mode: "never" });
 * style.bold("text"); // "text" (no ANSI codes)
 * ```
 */
export type ColorMode = "auto" | "always" | "never";

/**
 * Capability inputs for deterministic testing.
 *
 * When provided, these override the runtime environment checks.
 * This allows tests to simulate different terminal environments
 * without modifying `process.env` or `process.stdout`.
 */
export interface CapabilityOverrides {
	/** Override `process.stdout.isTTY`. */
	readonly isTTY?: boolean;
	/** Override `process.env.NO_COLOR`. */
	readonly noColor?: string | undefined;
}

/**
 * Configuration options for creating a style instance.
 *
 * @example
 * ```ts
 * const style = createStyle({ mode: "always" });
 * ```
 */
export interface StyleOptions {
	/** Color emission mode. Defaults to `"auto"`. */
	readonly mode?: ColorMode;
	/** Capability overrides for deterministic testing. */
	readonly overrides?: CapabilityOverrides;
}

/**
 * A style function that applies an ANSI style pair to text,
 * respecting the configured color mode.
 */
export type StyleFn = (text: string) => string;

/**
 * A configured style instance with mode-aware styling functions.
 *
 * In `"never"` mode, all functions return plain text without ANSI codes.
 * In `"always"` mode, ANSI codes are always emitted.
 * In `"auto"` mode, behavior depends on terminal capability detection.
 */
export interface StyleInstance {
	/** Whether ANSI codes will be emitted by this instance. */
	readonly enabled: boolean;

	// ── Style engine ──────────────────────────────────────────────────────

	/** Apply an arbitrary ANSI pair to text, respecting the color mode. */
	readonly apply: (text: string, pair: AnsiPair) => string;

	// ── Modifiers ─────────────────────────────────────────────────────────

	readonly bold: StyleFn;
	readonly dim: StyleFn;
	readonly italic: StyleFn;
	readonly underline: StyleFn;
	readonly inverse: StyleFn;
	readonly hidden: StyleFn;
	readonly strikethrough: StyleFn;

	// ── Foreground colors ─────────────────────────────────────────────────

	readonly black: StyleFn;
	readonly red: StyleFn;
	readonly green: StyleFn;
	readonly yellow: StyleFn;
	readonly blue: StyleFn;
	readonly magenta: StyleFn;
	readonly cyan: StyleFn;
	readonly white: StyleFn;
	readonly gray: StyleFn;
	readonly brightRed: StyleFn;
	readonly brightGreen: StyleFn;
	readonly brightYellow: StyleFn;
	readonly brightBlue: StyleFn;
	readonly brightMagenta: StyleFn;
	readonly brightCyan: StyleFn;
	readonly brightWhite: StyleFn;

	// ── Background colors ─────────────────────────────────────────────────

	readonly bgBlack: StyleFn;
	readonly bgRed: StyleFn;
	readonly bgGreen: StyleFn;
	readonly bgYellow: StyleFn;
	readonly bgBlue: StyleFn;
	readonly bgMagenta: StyleFn;
	readonly bgCyan: StyleFn;
	readonly bgWhite: StyleFn;
	readonly bgBrightBlack: StyleFn;
	readonly bgBrightRed: StyleFn;
	readonly bgBrightGreen: StyleFn;
	readonly bgBrightYellow: StyleFn;
	readonly bgBrightBlue: StyleFn;
	readonly bgBrightMagenta: StyleFn;
	readonly bgBrightCyan: StyleFn;
	readonly bgBrightWhite: StyleFn;
}
