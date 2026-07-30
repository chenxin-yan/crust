// ────────────────────────────────────────────────────────────────────────────
// Create Theme — Typed partial override merging with default theme
// ────────────────────────────────────────────────────────────────────────────

import { createStyle } from "../createStyle.ts";
import type { StyleOptions } from "../types.ts";
import {
	buildDefaultMarkdownTheme,
	type MarkdownTheme,
	type PartialMarkdownTheme,
} from "./markdownTheme.ts";

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

/**
 * Options for {@link createMarkdownTheme}.
 */
export interface CreateMarkdownThemeOptions {
	/**
	 * Style configuration options (mode and capability overrides).
	 *
	 * When provided, a new {@link StyleInstance} is created with these
	 * options and used to build the default theme base. When omitted,
	 * the default `"auto"` mode is used.
	 */
	readonly style?: StyleOptions;

	/**
	 * Partial theme overrides to merge on top of the default theme.
	 *
	 * Only the slots you provide are overridden; all other slots
	 * inherit from the default theme.
	 *
	 * @example
	 * ```ts
	 * createMarkdownTheme({
	 *   overrides: {
	 *     heading1: (value) => `## ${value.toUpperCase()} ##`,
	 *   },
	 * });
	 * ```
	 */
	readonly overrides?: PartialMarkdownTheme;
}

// ────────────────────────────────────────────────────────────────────────────
// Factory
// ────────────────────────────────────────────────────────────────────────────

/**
 * Create a {@link MarkdownTheme} with optional style configuration and
 * partial slot overrides.
 *
 * The factory builds a default theme using the specified style mode and
 * then applies any provided overrides on top. This enables consumers to
 * customize individual slots while inheriting defaults for the rest.
 *
 * @param options - Style configuration and/or partial theme overrides.
 * @returns A frozen {@link MarkdownTheme} instance.
 *
 * @example
 * ```ts
 * import { createMarkdownTheme } from "@crustjs/style";
 *
 * // Default theme with auto mode
 * const theme = createMarkdownTheme();
 *
 * // Force colors + custom heading
 * const custom = createMarkdownTheme({
 *   style: { mode: "always" },
 *   overrides: {
 *     heading1: (value) => `# ${value.toUpperCase()}`,
 *   },
 * });
 * ```
 */
export function createMarkdownTheme(options?: CreateMarkdownThemeOptions): MarkdownTheme {
	const styleInstance = createStyle(options?.style);
	const base = buildDefaultMarkdownTheme(styleInstance);
	const overrides = options?.overrides;

	if (!overrides) {
		return base;
	}

	const definedOverrides = Object.fromEntries(
		Object.entries(overrides).filter(([, value]) => value !== undefined),
	);
	return Object.freeze({ ...base, ...definedOverrides });
}

/**
 * Default markdown theme using `"auto"` mode.
 *
 * Emits styled output when stdout is a TTY and `NO_COLOR` is not set.
 * Import this for convenient access without explicit configuration.
 *
 * @example
 * ```ts
 * import { defaultTheme } from "@crustjs/style";
 *
 * console.log(defaultTheme.heading1("Title"));
 * console.log(defaultTheme.strong("important"));
 * ```
 */
export const defaultTheme: MarkdownTheme = createMarkdownTheme();
