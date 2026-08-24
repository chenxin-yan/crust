// ────────────────────────────────────────────────────────────────────────────
// Types — Mode, options, and shared type definitions
// ────────────────────────────────────────────────────────────────────────────

import type { AnsiPair, StyleMethodName as RegisteredStyleMethodName } from "./ansiCodes.ts";
import type { HyperlinkOptions } from "./hyperlinks.ts";
import type { NamedColor } from "./namedColorValues.ts";

/** Completion hints for supported non-named color strings. */
type ColorSyntaxHint = "#" | "rgb()";

/**
 * String forms accepted by `fg` / `bg`.
 *
 * Editors autocomplete the 148 CSS {@link NamedColor | named colors}
 * plus {@link ColorSyntaxHint | syntax hints} for hex (`#`) and `rgb()`.
 * Other strings remain assignable so dynamic input can be validated at runtime.
 */
export type ColorString = NamedColor | ColorSyntaxHint | (string & {});

/**
 * Input accepted by `fg` and `bg`.
 *
 * Accepted shapes are hex strings (`#rgb` / `#rrggbb`), the 148 named CSS
 * colors, `rgb(r, g, b)` / `rgb(r g b)` strings, and `[r, g, b]` tuples with
 * integer channels from 0 through 255 (separators must not be mixed).
 * Invalid inputs throw `TypeError` at call time.
 */
export type ColorInput = ColorString | readonly [r: number, g: number, b: number];

/**
 * Color emission mode for a style instance.
 *
 * - `"auto"` — Read the environment on resolution: colors are emitted
 *   when stdout is a TTY and `NO_COLOR` is not set (or is empty);
 *   non-color modifiers (bold, italic, etc.) follow TTY only and are
 *   **not** affected by `NO_COLOR`. `FORCE_COLOR`, when set, decides
 *   unconditionally for both (the all-ANSI switch).
 * - `"always"` — Always emit ANSI codes regardless of terminal detection.
 * - `"never"` — Suppress every form of ANSI (colors, modifiers,
 *   hyperlinks); functions return plain text.
 *
 * The default `style` facade and top-level helpers always run in
 * `"auto"` mode — to influence them globally, set the standard
 * environment variables (`NO_COLOR`, `FORCE_COLOR`). The facade and helpers
 * re-resolve capabilities on every direct call; stored sub-chains capture them
 * when accessed (see {@link ChainableStyleFn}).
 *
 * @example
 * ```ts
 * createStyle({ mode: "never" }).bold("text");  // "text" (no ANSI)
 *
 * process.env.NO_COLOR = "1";
 * style.red("text");                            // "text" (color off)
 * style.bold("text");                           // "\x1b[1mtext\x1b[22m"
 * ```
 */
export type ColorMode = "auto" | "always" | "never";

/**
 * Resolved color depth tier for a terminal.
 *
 * - `"truecolor"` — 24-bit color. Required for full {@link ColorInput} fidelity.
 * - `"256"` — 256-color extended palette; arbitrary RGB inputs are quantized.
 * - `"16"` — Standard 16-color ANSI (`\x1b[3X/9Xm` fg, `\x1b[4X/10Xm` bg).
 *   Quantized in-package to the closest match against the basic ANSI
 *   color set.
 * - `"none"` — Color emission is disabled. {@link fg} / {@link bg} return the
 *   input text unchanged.
 *
 * Exposed on {@link StyleInstance} as `colorDepth` for introspection.
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
	/**
	 * Override `process.env.FORCE_COLOR`. When set, decides unconditionally
	 * (overrides TTY and `NO_COLOR`): `"0"` / `"false"` force all ANSI off;
	 * `"1"` / `"2"` / `"3"` force color on at 16 / 256 / truecolor depth;
	 * any other value forces on at the detected depth.
	 */
	readonly forceColor?: string | undefined;
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
	/**
	 * Color emission mode.
	 * @default "auto"
	 */
	readonly mode?: ColorMode;
	/** Capability overrides for deterministic testing. */
	readonly overrides?: CapabilityOverrides;
}

/** Input accepted by style functions. Nullish values become an empty string; others are stringified. */
export type StyleInput = { toString(): string } | null | undefined;

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
 * A callable style function that also exposes all style methods for
 * chaining and the underlying {@link AnsiPair} (`open` / `close`) for
 * manual hot-path composition (chalk/ansis parity).
 *
 * Every chainable is simultaneously a function, a chain root, and an
 * ANSI pair. Chains compose `open` left-to-right and `close` right-to-left.
 *
 * On the default runtime facade, a first-level chainable such as `style.bold`
 * re-resolves terminal capabilities when called. Extending it freezes the
 * current capabilities, so a stored sub-chain such as `style.bold.red` keeps
 * the environment state from when the property was accessed.
 *
 * To pass a style around as a value, pass the chainable itself — it is
 * already a `(text: string) => string` function (see {@link StyleFn}).
 *
 * @example
 * ```ts
 * import { style } from "@crustjs/style";
 *
 * // Direct call
 * style.bold.red("error");
 *
 * // Style as a value — chainables are plain functions
 * const paint: StyleFn = style.bold.red;
 * paint("error");
 *
 * // Manual composition in a hot loop (mode-unaware — static codes)
 * const { open, close } = style.bold;
 * out.write(open + chunk + close);
 * ```
 */
export interface ChainableStyleFn extends StyleMethodMap, AnsiPair {
	/**
	 * Apply the chain to a string. `null` / `undefined` return `""`;
	 * other non-string inputs are stringified via `String(value)`.
	 */
	(text: StyleInput): string;
	/**
	 * Apply the chain to a tagged template literal. Interpolated values
	 * are coerced via `String(...)`; nested chain calls inside `${...}`
	 * work because each inner chainable emits its own ANSI sequences,
	 * and the outer style is re-opened after any inner close code that
	 * matches the outer close.
	 *
	 * @example
	 * ```ts
	 * style.bold.red`Build ${style.cyan`./dist`} in ${ms}ms`;
	 * ```
	 */
	(strings: TemplateStringsArray, ...values: unknown[]): string;
	/**
	 * Append a depth-aware foreground color to the chain. The resulting
	 * chainable can be called or chained further like any other.
	 *
	 * @example
	 * ```ts
	 * style.bold.fg("#ff8800")("warning");
	 * style.fg("rebeccapurple").italic`accent ${value}`;
	 * ```
	 */
	fg(input: ColorInput): ChainableStyleFn;
	/**
	 * Append a depth-aware background color to the chain. Mirrors
	 * {@link ChainableStyleFn.fg}.
	 */
	bg(input: ColorInput): ChainableStyleFn;
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

	/** Wrap text in an OSC 8 hyperlink when link styling is enabled. */
	readonly link: (text: string, url: string, options?: HyperlinkOptions) => string;

	// ── Dynamic colors ──

	/**
	 * Apply a foreground color to text from a hex string, named CSS color,
	 * `rgb()` string, or `[r, g, b]` tuple. Output is rendered at the depth captured at
	 * `createStyle()` time — see {@link StyleInstance.colorDepth}.
	 *
	 * Two call shapes:
	 * - `fg(text, input)` — direct application, returns the styled string.
	 * - `fg(input)` — returns a {@link ChainableStyleFn} pre-bound with the
	 *   color, ready to be called or chained further.
	 *
	 * @example
	 * ```ts
	 * style.fg("warning", "#ff8800");           // direct
	 * style.fg("#ff8800").bold("warning");      // chain root
	 * ```
	 */
	readonly fg: {
		(input: ColorInput): ChainableStyleFn;
		(text: string, input: ColorInput): string;
	};

	/**
	 * Apply a background color to text. Mirrors {@link StyleInstance.fg} —
	 * supports both `bg(text, input)` direct application and `bg(input)`
	 * chain-root forms.
	 */
	readonly bg: {
		(input: ColorInput): ChainableStyleFn;
		(text: string, input: ColorInput): string;
	};
}
