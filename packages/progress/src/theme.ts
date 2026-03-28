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

export function createTheme(overrides?: PartialProgressTheme): ProgressTheme {
	if (!overrides) return defaultTheme;
	return { ...defaultTheme, ...overrides };
}

let globalOverrides: PartialProgressTheme | undefined;

export function setTheme(theme?: PartialProgressTheme): void {
	globalOverrides = theme;
}

export function getTheme(): ProgressTheme {
	if (!globalOverrides) return defaultTheme;
	return { ...defaultTheme, ...globalOverrides };
}

export function resolveTheme(
	progressTheme?: PartialProgressTheme,
): ProgressTheme {
	if (!globalOverrides && !progressTheme) return defaultTheme;
	return {
		...defaultTheme,
		...globalOverrides,
		...progressTheme,
	};
}
