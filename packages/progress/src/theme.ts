// ────────────────────────────────────────────────────────────────────────────
// Theme — Default theme and resolution for @crustjs/progress
// ────────────────────────────────────────────────────────────────────────────

import { createStyle, style } from "@crustjs/style";
import type { StyleFn, StyleInstance } from "@crustjs/style";

export interface ProgressTheme {
	/** Spinner frame characters while the task is running. */
	readonly spinner: StyleFn;
	/** The status message displayed beside the spinner or final symbol. */
	readonly message: StyleFn;
	/** Final success symbol styling. */
	readonly success: StyleFn;
	/** Final error symbol styling. */
	readonly error: StyleFn;
}

/** Partial version of `ProgressTheme` for user overrides. */
export type PartialProgressTheme = Partial<ProgressTheme>;

function themeFromStyle(s: StyleInstance): ProgressTheme {
	return { spinner: s.magenta, message: s.bold, success: s.green, error: s.red };
}

/**
 * Default theme; its TTY check reads `process.stdout`. Spinners fill unset
 * theme slots with these styles detected from their own sink instead.
 */
export const defaultTheme: ProgressTheme = themeFromStyle(style);

/** {@link defaultTheme} with color support detected from `sink` rather than stdout. */
export function defaultThemeFor(sink: { readonly isTTY?: boolean }): ProgressTheme {
	// Same TTY state as stdout: the late-bound default already decides, without building a style.
	if ((sink.isTTY ?? false) === (process.stdout?.isTTY ?? false)) return defaultTheme;
	return themeFromStyle(createStyle({ overrides: { isTTY: sink.isTTY } }));
}
