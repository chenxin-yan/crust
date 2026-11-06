// ────────────────────────────────────────────────────────────────────────────
// Theme — Default theme and resolution for @crustjs/progress
// ────────────────────────────────────────────────────────────────────────────

import { bold, createPlainStyle, green, magenta, red } from "@crustjs/style";
import type { PlainStyle, StyleFn } from "@crustjs/style";

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

function themeFromStyle(s: Pick<PlainStyle, "bold" | "green" | "magenta" | "red">): ProgressTheme {
	return { spinner: s.magenta, message: s.bold, success: s.green, error: s.red };
}

/**
 * Default theme; its TTY check reads `process.stdout`. Spinners fill unset
 * theme slots with these styles detected from their own sink instead.
 */
export const defaultTheme: ProgressTheme = themeFromStyle({ bold, green, magenta, red });

/**
 * {@link defaultTheme} with color support detected from `sink` rather than stdout, so a spinner
 * never creates `process.stdout` just to pick its colors.
 */
export function defaultThemeFor(sink: { readonly isTTY?: boolean }): ProgressTheme {
	// Env is snapshotted once per spinner here; changing it mid-render is not a real use case.
	return themeFromStyle(createPlainStyle({ overrides: { isTTY: sink.isTTY } }));
}
