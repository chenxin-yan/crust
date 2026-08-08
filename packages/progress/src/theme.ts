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

let globalOverrides: PartialProgressTheme | undefined;

export function setTheme(theme?: PartialProgressTheme): void {
	globalOverrides = theme;
}

export function resolveTheme(progressTheme?: PartialProgressTheme): ProgressTheme {
	if (!globalOverrides && !progressTheme) return defaultTheme;
	return {
		...defaultTheme,
		...globalOverrides,
		...progressTheme,
	};
}
