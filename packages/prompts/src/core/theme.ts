// ────────────────────────────────────────────────────────────────────────────
// Theme — Default theme, global state, and resolution for @crustjs/prompts
// ────────────────────────────────────────────────────────────────────────────

import { bold, cyan, dim, green, magenta, red, yellow } from "@crustjs/style";
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
	selected: yellow,
	unselected: dim,
	error: red,
	success: green,
	hint: dim,
	spinner: magenta,
	filterMatch: cyan,
};

// ────────────────────────────────────────────────────────────────────────────
// Theme Creation
// ────────────────────────────────────────────────────────────────────────────

/**
 * Create a complete theme by merging partial overrides onto the default theme.
 *
 * Use this to build a reusable theme object, then apply it globally
 * with {@link setTheme}.
 *
 * @param overrides - Partial theme slots to override. Only specified slots
 *   are replaced; all others retain their default values.
 * @returns A complete `PromptTheme` with all slots defined.
 *
 * @example
 * ```ts
 * import { createTheme, setTheme } from "@crustjs/prompts";
 * import { magenta, cyan } from "@crustjs/style";
 *
 * const myTheme = createTheme({
 *   prefix: magenta,
 *   success: cyan,
 * });
 *
 * // Apply globally so all prompts use it
 * setTheme(myTheme);
 * ```
 */
export function createTheme(overrides?: PartialPromptTheme): PromptTheme {
	if (!overrides) return defaultTheme;
	return { ...defaultTheme, ...overrides };
}

// ────────────────────────────────────────────────────────────────────────────
// Global Theme State
// ────────────────────────────────────────────────────────────────────────────

/** Module-level global theme overrides, applied to all prompts. */
let globalOverrides: PartialPromptTheme | undefined;

/**
 * Set the global theme applied to all prompts.
 *
 * Accepts either a complete `PromptTheme` (e.g., from {@link createTheme})
 * or a `PartialPromptTheme` with only the slots you want to override.
 * Unspecified slots fall back to {@link defaultTheme}.
 *
 * Call with no arguments or `undefined` to clear the global theme.
 *
 * @param theme - Theme or partial overrides to apply globally.
 *
 * @example
 * ```ts
 * import { setTheme } from "@crustjs/prompts";
 * import { magenta, cyan } from "@crustjs/style";
 *
 * // Set once at app bootstrap
 * setTheme({ prefix: magenta, success: cyan });
 *
 * // Clear the global theme
 * setTheme();
 * ```
 */
export function setTheme(theme?: PartialPromptTheme): void {
	globalOverrides = theme;
}

/**
 * Get the current global theme with all slots resolved.
 *
 * Returns {@link defaultTheme} if no global theme has been set.
 *
 * @returns The complete resolved global `PromptTheme`.
 *
 * @example
 * ```ts
 * import { getTheme, setTheme } from "@crustjs/prompts";
 *
 * setTheme({ prefix: magenta });
 * const theme = getTheme();
 * // theme.prefix === magenta
 * // theme.message === bold (default)
 * ```
 */
export function getTheme(): PromptTheme {
	if (!globalOverrides) return defaultTheme;
	return { ...defaultTheme, ...globalOverrides };
}

// ────────────────────────────────────────────────────────────────────────────
// Theme Resolution (internal)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Resolve the effective theme for a single prompt by layering global
 * and per-prompt overrides.
 *
 * Resolution order (later wins):
 * 1. {@link defaultTheme} (base)
 * 2. Global overrides (set via {@link setTheme})
 * 3. Per-prompt overrides (passed to individual prompt options)
 *
 * @internal — Prompt implementations call this; users do not need to.
 *
 * @param promptTheme - Per-prompt theme overrides (highest priority)
 * @returns A complete `PromptTheme` with all slots defined.
 */
export function resolveTheme(promptTheme?: PartialPromptTheme): PromptTheme {
	if (!globalOverrides && !promptTheme) return defaultTheme;
	return {
		...defaultTheme,
		...globalOverrides,
		...promptTheme,
	};
}
