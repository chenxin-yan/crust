// ────────────────────────────────────────────────────────────────────────────
// Theme — Default theme and resolution for @crustjs/progress
// ────────────────────────────────────────────────────────────────────────────

import { bold, green, magenta, red } from "@crustjs/style";
import type { StyleFn } from "@crustjs/style";

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

export const defaultTheme: ProgressTheme = {
	spinner: magenta,
	message: bold,
	success: green,
	error: red,
};

/**
 * Resolve a complete theme by merging partial overrides onto
 * {@link defaultTheme}.
 *
 * @internal — Indicator implementations call this; users do not need to.
 */
export function resolveTheme(progressTheme?: PartialProgressTheme): ProgressTheme {
	if (!progressTheme) return defaultTheme;
	return { ...defaultTheme, ...progressTheme };
}
