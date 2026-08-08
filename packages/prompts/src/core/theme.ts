// ────────────────────────────────────────────────────────────────────────────
// Theme — Default theme and resolution for @crustjs/prompts
// ────────────────────────────────────────────────────────────────────────────

import { bold, cyan, dim, green, red } from "@crustjs/style";

import type { PartialPromptTheme, PromptTheme } from "./types.ts";

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

// ────────────────────────────────────────────────────────────────────────────
// Theme Resolution (internal)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Resolve a complete theme by merging partial overrides onto
 * {@link defaultTheme}. Instance themes from `createPrompts` are
 * pre-merged into the per-prompt overrides before this runs.
 *
 * @internal — Prompt implementations call this; users do not need to.
 *
 * @param promptTheme - Partial theme overrides
 * @returns A complete `PromptTheme` with all slots defined.
 */
export function resolveTheme(promptTheme?: PartialPromptTheme): PromptTheme {
	if (!promptTheme) return defaultTheme;
	return { ...defaultTheme, ...promptTheme };
}
