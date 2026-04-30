// ────────────────────────────────────────────────────────────────────────────
// Types — Mode, options, and shared type definitions
// ────────────────────────────────────────────────────────────────────────────

import type { AnsiPair } from "./ansiCodes.ts";
import type { HyperlinkOptions } from "./hyperlinks.ts";
import type { StyleMethodName as RegisteredStyleMethodName } from "./styleMethodRegistry.ts";

/**
 * Input accepted by `fg`, `bg`, `fgCode`, and `bgCode` — sourced directly
 * from [`Bun.color()`](https://bun.com/docs/runtime/color)'s parameter
 * type, so it always tracks Bun's accepted surface (hex, named CSS
 * colors, `rgb()` / `rgba()`, `hsl()` / `hsla()`, `lab()`, numeric
 * literals, `{ r, g, b, a? }` objects, and `[r, g, b]` / `[r, g, b, a]`
 * arrays).
 */
export type ColorInput = Parameters<typeof Bun.color>[0];

/**
 * Color emission mode for the style engine.
 *
 * - `"auto"` — Emit color ANSI codes when stdout is a TTY and `NO_COLOR` is
 *   not set (or is empty). Non-color modifiers (bold, italic, etc.) are always
 *   emitted in `"auto"` mode regardless of TTY or `NO_COLOR`.
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
 * Resolved color depth tier for a terminal.
 *
 * - `"truecolor"` — 24-bit color (`Bun.color(input, "ansi-16m")`). Required
 *   for full {@link ColorInput} fidelity.
 * - `"256"` — 256-color extended palette (`Bun.color(input, "ansi-256")`).
 *   `Bun.color()` picks the closest palette index for arbitrary RGB inputs.
 * - `"16"` — Standard 16-color ANSI (`\x1b[3X/9Xm` fg, `\x1b[4X/10Xm` bg).
 *   Quantized in-package to the closest match against the basic ANSI
 *   color set.
 * - `"none"` — Color emission is disabled. {@link fg} / {@link bg} return the
 *   input text unchanged.
 *
 * Used by {@link resolveColorDepth} and exposed on {@link StyleInstance} as
 * `colorDepth` for introspection.
 */
export type ColorDepth = "truecolor" | "256" | "16" | "none";

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
	/** Override `process.env.NO_COLOR`. Non-empty values disable color. */
	readonly noColor?: string | undefined;
}

/**
 * Truecolor capability overrides for deterministic testing.
 *
 * These override environment variable checks used by
 * {@link resolveTrueColorCapability} to detect 24-bit color support.
 */
export interface TrueColorOverrides {
	/** Override `process.env.COLORTERM`. */
	readonly colorTerm?: string | undefined;
	/** Override `process.env.TERM`. */
	readonly term?: string | undefined;
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
	readonly overrides?: CapabilityOverrides & TrueColorOverrides;
}

/**
 * A style function that applies an ANSI style pair to text,
 * respecting the configured color mode.
 */
export type StyleFn = (text: string) => string;

/**
 * Shared style method surface used by style instances and chainable style
 * functions.
 */
export type StyleMethodMap = {
	readonly [K in StyleMethodName]: ChainableStyleFn;
};

/**
 * A callable style function that also exposes all style methods for chaining.
 *
 * @example
 * ```ts
 * style.bold.red("error");
 * ```
 */
export interface ChainableStyleFn extends StyleMethodMap {
	(text: string): string;
}

/**
 * Style method name used by the chain builder implementation.
 */
export type StyleMethodName = RegisteredStyleMethodName;

/**
 * A configured style instance with mode-aware styling functions.
 *
 * In `"never"` mode, all functions return plain text without ANSI codes.
 * In `"always"` mode, ANSI codes are always emitted.
 * In `"auto"` mode, behavior depends on terminal capability detection.
 */
export interface StyleInstance extends StyleMethodMap {
	/** Whether any ANSI styling will be emitted by this instance. */
	readonly enabled: boolean;

	/** Whether ANSI color codes will be emitted by this instance. */
	readonly colorsEnabled: boolean;

	/** Whether truecolor (24-bit) sequences will be emitted by this instance. */
	readonly trueColorEnabled: boolean;

	/**
	 * The resolved color depth tier this instance will emit through
	 * {@link fg} / {@link bg}. Equivalent to {@link trueColorEnabled} when
	 * `"truecolor"`; `"none"` indicates color emission is disabled.
	 */
	readonly colorDepth: ColorDepth;

	// ── Style engine ──────────────────────────────────────────────────────

	/** Apply an arbitrary ANSI pair to text, respecting the color mode. */
	readonly apply: (text: string, pair: AnsiPair) => string;

	/** Wrap text in an OSC 8 hyperlink when link styling is enabled. */
	readonly link: (
		text: string,
		url: string,
		options?: HyperlinkOptions,
	) => string;

	// ── Dynamic colors ──

	/**
	 * Apply a foreground color to text from any input `Bun.color()` accepts
	 * (hex, named CSS colors, `rgb()`, `hsl()`, numeric, `{ r, g, b }`,
	 * `[r, g, b]`, etc.). Output is rendered at the depth captured at
	 * `createStyle()` time — see {@link StyleInstance.colorDepth}.
	 */
	readonly fg: (text: string, input: ColorInput) => string;

	/**
	 * Apply a background color to text from any {@link ColorInput}. Output is
	 * rendered at the depth captured at `createStyle()` time — see
	 * {@link StyleInstance.colorDepth}.
	 */
	readonly bg: (text: string, input: ColorInput) => string;

	// ── Deprecated dynamic-color helpers ───────────────────────────────

	/**
	 * Apply a truecolor foreground RGB color to text.
	 *
	 * @deprecated Use {@link StyleInstance.fg | `fg(text, [r, g, b])`}
	 * instead.
	 */
	readonly rgb: (text: string, r: number, g: number, b: number) => string;

	/**
	 * Apply a truecolor background RGB color to text.
	 *
	 * @deprecated Use {@link StyleInstance.bg | `bg(text, [r, g, b])`}
	 * instead.
	 */
	readonly bgRgb: (text: string, r: number, g: number, b: number) => string;

	/**
	 * Apply a truecolor foreground hex color to text.
	 *
	 * @deprecated Use {@link StyleInstance.fg | `fg(text, "#rrggbb")`}
	 * instead.
	 */
	readonly hex: (text: string, hexColor: string) => string;

	/**
	 * Apply a truecolor background hex color to text.
	 *
	 * @deprecated Use {@link StyleInstance.bg | `bg(text, "#rrggbb")`}
	 * instead.
	 */
	readonly bgHex: (text: string, hexColor: string) => string;
}
