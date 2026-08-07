// ────────────────────────────────────────────────────────────────────────────
// Types — Mode, options, and shared type definitions
// ────────────────────────────────────────────────────────────────────────────

import type { AnsiPair } from "./ansiCodes.ts";
import type { HyperlinkOptions } from "./hyperlinks.ts";
import type { LiteralUnion, NamedColor } from "./namedColors.ts";
import type { StyleMethodName as RegisteredStyleMethodName } from "./styleMethodRegistry.ts";

/**
 * Completion-bait literals for the non-named color syntaxes: the `#` hex
 * prefix and the CSS functional notations `Bun.color()` parses.
 *
 * These are concrete literals — not template-literal types — because
 * TypeScript only expands template literals with *finite* holes into
 * completion entries; `` `rgb(${string})` `` produces nothing, not even
 * the prefix. A picked entry like `"rgb()"` is filled in by the user;
 * `Bun.color()` validates the result at runtime and throws `TypeError`
 * on garbage. Contents are deliberately NOT validated at the type level.
 */
type ColorSyntaxHint =
	| "#"
	| "rgb()"
	| "rgba()"
	| "hsl()"
	| "hsla()"
	| "hwb()"
	| "lab()"
	| "lch()"
	| "oklab()"
	| "oklch()";

/**
 * String forms accepted by `fg` / `bg`.
 *
 * Editors autocomplete the 148 CSS {@link NamedColor | named colors}
 * plus {@link ColorSyntaxHint | syntax hints} for hex (`#`) and
 * functional notation (`rgb()`, `hsl()`, `oklch()`, …), while still
 * accepting any other string Bun's CSS parser understands.
 *
 * The `string` fallback is preserved via {@link LiteralUnion} so dynamic
 * values — e.g. theme tokens loaded from JSON — still type-check.
 */
export type ColorString = LiteralUnion<NamedColor | ColorSyntaxHint, string>;

/**
 * Input accepted by `fg` and `bg`.
 *
 * Mirrors [`Bun.color()`](https://bun.com/docs/runtime/color)'s parameter
 * surface, with a richer `string` branch so editors autocomplete CSS
 * named colors plus hex and functional-notation syntax hints. All
 * members are assignable to `Bun.color()` at runtime.
 *
 * Accepted shapes:
 * - {@link ColorString} — hex (`"#f00"`, `"#ff0000"`, `"#ff000080"`),
 *   {@link NamedColor | named CSS colors} (`"rebeccapurple"`),
 *   functional notation (`"rgb(0, 128, 255)"`, `"hsl(210, 100%, 50%)"`,
 *   `"lab(50% 30 -20)"`).
 * - `number` — packed `0xRRGGBB` (24-bit, no alpha).
 * - `[r, g, b]` / `[r, g, b, a]` — channel tuples (0–255).
 * - `{ r, g, b, a? }` — channel objects (0–255; `a` defaults to 255).
 *
 * Invalid inputs throw a `TypeError` at call time (from `Bun.color()`
 * parsing), so typos surface immediately with the offending value in
 * the message.
 */
export type ColorInput =
	| ColorString
	| number
	| readonly [r: number, g: number, b: number]
	| readonly [r: number, g: number, b: number, a: number]
	| { r: number; g: number; b: number; a?: number };

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
 * environment variables (`NO_COLOR`, `FORCE_COLOR`); they re-resolve on
 * every call.
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
	(text: string): string;
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
	 * Apply a foreground color to text from any input `Bun.color()` accepts
	 * (hex, named CSS colors, `rgb()`, `hsl()`, numeric, `{ r, g, b }`,
	 * `[r, g, b]`, etc.). Output is rendered at the depth captured at
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
