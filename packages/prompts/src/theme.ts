// ────────────────────────────────────────────────────────────────────────────
// Theme — Default theme, creation, and resolution for @crustjs/prompts
// ────────────────────────────────────────────────────────────────────────────

import { bold, cyan, dim, green, magenta, red, yellow } from "@crustjs/style";
import type { PartialPromptTheme, PromptTheme } from "./types.ts";

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
	selected: yellow,
	unselected: dim,
	error: red,
	success: green,
	hint: dim,
	spinner: magenta,
	filterMatch: cyan,
};

/**
 * Create a complete theme by merging partial overrides onto the default theme.
 *
 * @param overrides - Partial theme slots to override. Only specified slots
 *   are replaced; all others retain their default values.
 * @returns A complete `PromptTheme` with all slots defined.
 *
 * @example
 * ```ts
 * const myTheme = createTheme({
 *   prefix: magenta,
 *   success: cyan,
 * });
 * ```
 */
export function createTheme(overrides?: PartialPromptTheme): PromptTheme {
	if (!overrides) return defaultTheme;
	return { ...defaultTheme, ...overrides };
}

/**
 * Resolve the effective theme by layering global and per-prompt overrides.
 *
 * Resolution order (later wins):
 * 1. `defaultTheme` (base)
 * 2. `globalTheme` overrides (user-wide customization)
 * 3. `promptTheme` overrides (per-prompt customization)
 *
 * @param globalTheme - Global theme overrides applied to all prompts
 * @param promptTheme - Per-prompt theme overrides (highest priority)
 * @returns A complete `PromptTheme` with all slots defined.
 *
 * @example
 * ```ts
 * // Global: make all prefixes magenta
 * // Per-prompt: make this prompt's error color yellow
 * const theme = resolveTheme(
 *   { prefix: magenta },
 *   { error: yellow },
 * );
 * ```
 */
export function resolveTheme(
	globalTheme?: PartialPromptTheme,
	promptTheme?: PartialPromptTheme,
): PromptTheme {
	if (!globalTheme && !promptTheme) return defaultTheme;
	return {
		...defaultTheme,
		...globalTheme,
		...promptTheme,
	};
}
