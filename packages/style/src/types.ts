// ────────────────────────────────────────────────────────────────────────────
// Types — Mode, options, and shared type definitions
// ────────────────────────────────────────────────────────────────────────────

import type { AnsiPair } from "./ansiCodes.ts";
import type { HyperlinkOptions } from "./hyperlinks.ts";
import type { LiteralUnion, NamedColor } from "./namedColors.ts";
import type { StyleMethodName as RegisteredStyleMethodName } from "./styleMethodRegistry.ts";

/**
 * String forms accepted by `fg` / `bg` / `fgCode` / `bgCode`.
 *
 * Editors autocomplete the 148 CSS {@link NamedColor | named colors} and
 * the `#` hex prefix while still accepting any other string Bun's CSS
 * parser understands (`rgb()` / `rgba()`, `hsl()` / `hsla()`, `lab()`,
 * `oklch()`, `#RGBA`, etc.).
 *
 * The `string` fallback is preserved via {@link LiteralUnion} so dynamic
 * values — e.g. theme tokens loaded from JSON — still type-check.
 */
export type ColorString = LiteralUnion<NamedColor | `#${string}`, string>;

/**
 * Input accepted by `fg`, `bg`, `fgCode`, and `bgCode`.
 *
 * Mirrors [`Bun.color()`](https://bun.com/docs/runtime/color)'s parameter
 * surface, with a richer `string` branch so editors autocomplete CSS
 * named colors and hint at hex literals. All members are assignable to
 * `Bun.color()` at runtime.
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
 * `ColorInput` is the broad runtime/dynamic type used for variable
 * annotations (e.g. `const c: ColorInput = loadFromJson()`). Inline
 * string literals passed directly to `fg` / `bg` / `fgCode` / `bgCode`
 * are checked against the stricter {@link CheckedColorInput} — typos
 * such as `fg("x", "rebbecapurple")` fail at compile time, while
 * dynamic `string` / {@link ColorString} / `ColorInput` values continue
 * to flow through unchanged.
 */
export type ColorInput =
	| ColorString
	| number
	| readonly [r: number, g: number, b: number]
	| readonly [r: number, g: number, b: number, a: number]
	| { r: number; g: number; b: number; a?: number };

/**
 * CSS color-function string forms recognized at the type level.
 *
 * Used by {@link StrictColorString} to validate inline color literals
 * passed to `fg` / `bg` / `fgCode` / `bgCode`. Template-literal types
 * can only check the broad `function(...)` shape; the actual argument
 * grammar (numeric ranges, separators, etc.) is validated at runtime by
 * `Bun.color()`.
 */
export type CssColorFunctionString =
	| `rgb(${string})`
	| `rgba(${string})`
	| `hsl(${string})`
	| `hsla(${string})`
	| `hwb(${string})`
	| `lab(${string})`
	| `lch(${string})`
	| `oklab(${string})`
	| `oklch(${string})`
	| `color(${string})`
	| `color-mix(${string})`;

/**
 * Strict subset of {@link ColorString} used to validate inline string
 * literals at compile time. Accepts named CSS colors, `#rrggbb` /
 * `#rgb` / `#rrggbbaa` hex literals, and {@link CssColorFunctionString}
 * function-notation strings. Anything else (typos, theme tokens, raw
 * variable references) must reach `fg` / `bg` through a widened
 * `string` / {@link ColorString} / {@link ColorInput} value.
 */
export type StrictColorString =
	| NamedColor
	| `#${string}`
	| CssColorFunctionString;

/**
 * Non-string branches of {@link ColorInput} (numbers, channel tuples,
 * channel objects). Derived from `ColorInput` so the two stay aligned
 * automatically.
 */
export type NonStringColorInput = Exclude<ColorInput, string>;

/**
 * Generic constraint accepted by the strict `fg` / `bg` / `fgCode` /
 * `bgCode` signatures. Any string or non-string `ColorInput` shape is
 * eligible — narrow inline string literals are validated by
 * {@link CheckedColorInput}.
 */
export type ColorInputCandidate = string | NonStringColorInput;

/**
 * Conditional helper that rejects invalid inline string literals while
 * preserving:
 *
 * - widened `string` values (e.g. `let c: string = load()`),
 * - inline literals matching {@link StrictColorString},
 * - all non-string {@link ColorInput} branches.
 *
 * Resolves to `never` for inline string literals that don't match
 * `StrictColorString`, which produces a TypeScript error at the call
 * site instead of silently passing through to `Bun.color()` and
 * throwing at runtime.
 */
export type CheckedColorInput<T> = T extends string
	? string extends T
		? T
		: T extends StrictColorString
			? T
			: never
	: T extends NonStringColorInput
		? T
		: never;

/**
 * Color emission mode for the style engine.
 *
 * - `"auto"` — Emit color ANSI codes when stdout is a TTY and `NO_COLOR`
 *   is not set (or is empty). Non-color modifiers (bold, italic, etc.) are
 *   always emitted in `"auto"` mode regardless of TTY or `NO_COLOR`.
 * - `"always"` — Always emit ANSI codes regardless of terminal detection.
 * - `"never"` — Disable ANSI emission. Behavior depends on the surface:
 *     - On `createStyle({ mode: "never" })`: every form of ANSI is
 *       suppressed (colors, modifiers, hyperlinks). The instance returns
 *       plain text.
 *     - On the runtime facade and top-level helpers via
 *       {@link setGlobalColorMode}: follows [no-color.org](https://no-color.org/)
 *       semantics — colors are suppressed, but non-color modifiers and
 *       hyperlinks continue to emit. This matches the conventional
 *       meaning of a `--no-color` flag while keeping `bold` / `italic`
 *       / `link` usable.
 *
 * @example
 * ```ts
 * createStyle({ mode: "never" }).bold("text");  // "text" (no ANSI)
 *
 * setGlobalColorMode("never");
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
 * {@link resolveColorDepth} to detect 24-bit color support.
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
 * A callable style function that also exposes all style methods for
 * chaining and the underlying {@link AnsiPair} (`open` / `close`) for
 * direct composition with {@link composeStyles} and {@link applyStyle}.
 *
 * Every chainable is simultaneously a function, a chain root, and an
 * ANSI pair. Chains compose `open` left-to-right and `close` right-to-left.
 *
 * **Byte-equivalence caveat.** `chain.open + text + chain.close` matches
 * `chain(text)` byte-for-byte only when adjacent steps have *distinct*
 * close codes. When two adjacent steps share a close code (e.g. `bold` and
 * `dim` both close with `\x1b[22m`), `applyStyle` emits an extra re-open
 * after the inner close to keep the outer style active on text the inner
 * step closed early; that re-open is part of `chain(text)` but not part
 * of the cached `chain.close`. Use `chain(text)` for emission and treat
 * `open` / `close` as composable building blocks for {@link composeStyles}.
 *
 * @example
 * ```ts
 * import { applyStyle, composeStyles, style } from "@crustjs/style";
 *
 * // Direct call
 * style.bold.red("error");
 *
 * // Same function reused as an AnsiPair
 * applyStyle("error", style.bold.red);
 * composeStyles(style.bold, style.red, style.bgYellow);
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
	 * and `applyStyle` re-opens the outer style after any inner close
	 * code that matches the outer close.
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
	 * Inline string literals are checked against {@link StrictColorString};
	 * widened `string` / {@link ColorString} / {@link ColorInput} values
	 * still flow through unchanged.
	 *
	 * @example
	 * ```ts
	 * style.bold.fg("#ff8800")("warning");
	 * style.fg("rebeccapurple").italic`accent ${value}`;
	 * ```
	 */
	fg<const T extends ColorInputCandidate>(
		input: CheckedColorInput<T>,
	): ChainableStyleFn;
	/**
	 * Append a depth-aware background color to the chain. Mirrors
	 * {@link ChainableStyleFn.fg}.
	 */
	bg<const T extends ColorInputCandidate>(
		input: CheckedColorInput<T>,
	): ChainableStyleFn;
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
	 *
	 * Two call shapes:
	 * - `fg(text, input)` — direct application, returns the styled string.
	 * - `fg(input)` — returns a {@link ChainableStyleFn} pre-bound with the
	 *   color, ready to be called or chained further.
	 *
	 * Inline string literals are validated against {@link StrictColorString};
	 * widened dynamic strings (`string` / {@link ColorString} /
	 * {@link ColorInput}) continue to type-check.
	 *
	 * @example
	 * ```ts
	 * style.fg("warning", "#ff8800");           // direct
	 * style.fg("#ff8800").bold("warning");      // chain root
	 * ```
	 */
	readonly fg: {
		<const T extends ColorInputCandidate>(
			input: CheckedColorInput<T>,
		): ChainableStyleFn;
		<const T extends ColorInputCandidate>(
			text: string,
			input: CheckedColorInput<T>,
		): string;
	};

	/**
	 * Apply a background color to text. Mirrors {@link StyleInstance.fg} —
	 * supports both `bg(text, input)` direct application and `bg(input)`
	 * chain-root forms.
	 */
	readonly bg: {
		<const T extends ColorInputCandidate>(
			input: CheckedColorInput<T>,
		): ChainableStyleFn;
		<const T extends ColorInputCandidate>(
			text: string,
			input: CheckedColorInput<T>,
		): string;
	};

	// ── Deprecated dynamic-color helpers ───────────────────────────────

	/**
	 * Apply a truecolor foreground RGB color to text.
	 *
	 * @deprecated Use {@link StyleInstance.fg | `fg(text, [r, g, b])`}
	 * instead. Will be removed in v1.0.0.
	 */
	readonly rgb: (text: string, r: number, g: number, b: number) => string;

	/**
	 * Apply a truecolor background RGB color to text.
	 *
	 * @deprecated Use {@link StyleInstance.bg | `bg(text, [r, g, b])`}
	 * instead. Will be removed in v1.0.0.
	 */
	readonly bgRgb: (text: string, r: number, g: number, b: number) => string;

	/**
	 * Apply a truecolor foreground hex color to text.
	 *
	 * @deprecated Use {@link StyleInstance.fg | `fg(text, "#rrggbb")`}
	 * instead. Will be removed in v1.0.0.
	 */
	readonly hex: (text: string, hexColor: string) => string;

	/**
	 * Apply a truecolor background hex color to text.
	 *
	 * @deprecated Use {@link StyleInstance.bg | `bg(text, "#rrggbb")`}
	 * instead. Will be removed in v1.0.0.
	 */
	readonly bgHex: (text: string, hexColor: string) => string;
}
