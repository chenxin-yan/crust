// ────────────────────────────────────────────────────────────────────────────
// Types — Mode, options, and shared type definitions
// ────────────────────────────────────────────────────────────────────────────

import type { AnsiPair } from "./ansiCodes.ts";
import type { StyleMethodName as RegisteredStyleMethodName } from "./styleMethodRegistry.ts";

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
	/** Whether ANSI codes will be emitted by this instance. */
	readonly enabled: boolean;

	// ── Style engine ──────────────────────────────────────────────────────

	/** Apply an arbitrary ANSI pair to text, respecting the color mode. */
	readonly apply: (text: string, pair: AnsiPair) => string;
}
