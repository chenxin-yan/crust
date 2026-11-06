// ────────────────────────────────────────────────────────────────────────────
// Theme — Default theme and resolution for @crustjs/prompts
// ────────────────────────────────────────────────────────────────────────────

import { bold, createPlainStyle, cyan, dim, green, type PlainStyle, red } from "@crustjs/style";

import type { PromptTheme } from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Default Theme
// ────────────────────────────────────────────────────────────────────────────

function themeFromStyle(
	s: Pick<PlainStyle, "bold" | "cyan" | "dim" | "green" | "red">,
): PromptTheme {
	return {
		prefix: s.cyan,
		message: s.bold,
		placeholder: s.dim,
		cursor: s.cyan,
		selected: s.cyan,
		unselected: s.dim,
		error: s.red,
		success: s.green,
		hint: s.dim,
		filterMatch: s.cyan,
	};
}

/**
 * Default prompt theme with a polished, gum/clack-inspired aesthetic.
 *
 * Uses `@crustjs/style` color functions for ANSI output that respects
 * terminal capability detection (NO_COLOR, non-TTY graceful degradation).
 * Its TTY check reads `process.stdout`; prompts fill unset theme slots
 * with these styles detected from their own output stream instead.
 */
export const defaultTheme: PromptTheme = themeFromStyle({ bold, cyan, dim, green, red });

/** {@link defaultTheme} with color support detected from `output` rather than stdout. */
export function defaultThemeFor(output: { readonly isTTY?: boolean }): PromptTheme {
	// Same TTY state as stdout: the late-bound default already decides, without building a style.
	if ((output.isTTY ?? false) === (process.stdout?.isTTY ?? false)) return defaultTheme;
	// Env is snapshotted once per prompt/spinner here; changing it mid-render is not a real use case.
	return themeFromStyle(createPlainStyle({ overrides: { isTTY: output.isTTY } }));
}
