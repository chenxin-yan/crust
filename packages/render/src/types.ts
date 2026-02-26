// ────────────────────────────────────────────────────────────────────────────
// Render Types — Shared types for the markdown rendering pipeline
// ────────────────────────────────────────────────────────────────────────────

import type { StyleOptions } from "@crustjs/style";
import type {
	MarkdownTheme,
	PartialMarkdownTheme,
} from "./theme/markdownTheme.ts";

/**
 * Options for configuring markdown rendering output.
 *
 * Controls the terminal width, theme styling, and color behavior
 * for both one-shot and streaming rendering.
 */
export interface RenderOptions {
	/**
	 * Maximum visible width (in terminal columns) for rendered output.
	 *
	 * Text wrapping and table layout respect this constraint.
	 * @default 80
	 */
	readonly width?: number;

	/**
	 * Theme to use for styling markdown constructs.
	 *
	 * Accepts a full {@link MarkdownTheme} or a {@link PartialMarkdownTheme}
	 * with partial overrides (remaining slots inherit from the default).
	 */
	readonly theme?: MarkdownTheme | PartialMarkdownTheme;

	/**
	 * Style options passed to the underlying `@crustjs/style` instance
	 * when building the default theme.
	 *
	 * Use this to control color mode (`auto`, `always`, `never`) and
	 * capability overrides. Ignored when a full `MarkdownTheme` is provided.
	 */
	readonly style?: StyleOptions;
}

/**
 * Internal rendering context passed through the tree walker.
 *
 * Carries the resolved theme, width, and any state needed
 * during recursive node rendering.
 */
export interface RenderContext {
	/** Resolved markdown theme with all slots populated. */
	readonly theme: MarkdownTheme;

	/** Maximum visible width for the current rendering scope. */
	readonly width: number;

	/**
	 * Current indentation prefix applied to the start of each line.
	 *
	 * Used for nested structures like blockquotes and list items.
	 * Empty string at the top level.
	 * @default ""
	 */
	readonly indent: string;
}
