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
export function createMarkdownTheme(
	options?: CreateMarkdownThemeOptions,
): MarkdownTheme {
	const styleInstance = createStyle(options?.style);
	const base = buildDefaultMarkdownTheme(styleInstance);
	const overrides = options?.overrides;

	if (!overrides) {
		return base;
	}

	// Merge overrides on top of the default theme
	const merged: MarkdownTheme = {
		heading1: overrides.heading1 ?? base.heading1,
		heading2: overrides.heading2 ?? base.heading2,
		heading3: overrides.heading3 ?? base.heading3,
		heading4: overrides.heading4 ?? base.heading4,
		heading5: overrides.heading5 ?? base.heading5,
		heading6: overrides.heading6 ?? base.heading6,
		text: overrides.text ?? base.text,
		emphasis: overrides.emphasis ?? base.emphasis,
		strong: overrides.strong ?? base.strong,
		strongEmphasis: overrides.strongEmphasis ?? base.strongEmphasis,
		strikethrough: overrides.strikethrough ?? base.strikethrough,
		inlineCode: overrides.inlineCode ?? base.inlineCode,
		linkText: overrides.linkText ?? base.linkText,
		linkUrl: overrides.linkUrl ?? base.linkUrl,
		autolink: overrides.autolink ?? base.autolink,
		blockquoteMarker: overrides.blockquoteMarker ?? base.blockquoteMarker,
		blockquoteText: overrides.blockquoteText ?? base.blockquoteText,
		listMarker: overrides.listMarker ?? base.listMarker,
		orderedListMarker: overrides.orderedListMarker ?? base.orderedListMarker,
		taskChecked: overrides.taskChecked ?? base.taskChecked,
		taskUnchecked: overrides.taskUnchecked ?? base.taskUnchecked,
		codeFence: overrides.codeFence ?? base.codeFence,
		codeInfo: overrides.codeInfo ?? base.codeInfo,
		codeText: overrides.codeText ?? base.codeText,
		thematicBreak: overrides.thematicBreak ?? base.thematicBreak,
		tableHeader: overrides.tableHeader ?? base.tableHeader,
		tableCell: overrides.tableCell ?? base.tableCell,
		tableBorder: overrides.tableBorder ?? base.tableBorder,
		imageAltText: overrides.imageAltText ?? base.imageAltText,
		imageUrl: overrides.imageUrl ?? base.imageUrl,
	};

	return Object.freeze(merged);
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
