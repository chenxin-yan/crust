// ────────────────────────────────────────────────────────────────────────────
// Theme — Default theme and resolution for @crustjs/prompts
// ────────────────────────────────────────────────────────────────────────────

import { bold, cyan, dim, green, red } from "@crustjs/style";

import type { PromptTheme } from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Default Theme
// ────────────────────────────────────────────────────────────────────────────

/**
 * Default prompt theme with a polished, gum/clack-inspired aesthetic.
 *
 * Uses `@crustjs/style` color functions for ANSI output that respects
 * terminal capability detection (NO_COLOR, non-TTY graceful degradation).
 */
export const defaultTheme: PromptTheme = {
	prefix: cyan,
	message: bold,
	placeholder: dim,
	cursor: cyan,
	selected: cyan,
	unselected: dim,
	error: red,
	success: green,
	hint: dim,
	filterMatch: cyan,
};
