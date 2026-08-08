// ────────────────────────────────────────────────────────────────────────────
// Theme — Default theme, global state, and resolution for @crustjs/progress
// ────────────────────────────────────────────────────────────────────────────

import { bold, green, magenta, red } from "@crustjs/style";

import type { PartialProgressTheme, ProgressTheme } from "./types.ts";

export const defaultTheme: ProgressTheme = {
	spinner: magenta,
	message: bold,
	success: green,
	error: red,
};

/**
 * Resolve a complete theme by merging partial overrides onto
 * {@link defaultTheme}. Instance themes from `createProgress` are
 * pre-merged into the per-call overrides before this runs.
 *
 * @internal — Indicator implementations call this; users do not need to.
 */
export function resolveTheme(progressTheme?: PartialProgressTheme): ProgressTheme {
	if (!progressTheme) return defaultTheme;
	return { ...defaultTheme, ...progressTheme };
}
