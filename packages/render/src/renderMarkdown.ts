// ────────────────────────────────────────────────────────────────────────────
// renderMarkdown — One-shot markdown-to-terminal rendering API
// ────────────────────────────────────────────────────────────────────────────

import { parseMd } from "./parse.ts";
import { renderBlocks } from "./render.ts";
import { createMarkdownTheme } from "./theme/createMarkdownTheme.ts";
import type { MarkdownTheme } from "./theme/markdownTheme.ts";
import type { RenderContext, RenderOptions } from "./types.ts";

/** All required slot names on a full MarkdownTheme. */
const THEME_SLOTS: ReadonlyArray<keyof MarkdownTheme> = [
	"heading1",
	"heading2",
	"heading3",
	"heading4",
	"heading5",
	"heading6",
	"text",
	"emphasis",
	"strong",
	"strongEmphasis",
	"strikethrough",
	"inlineCode",
	"linkText",
	"linkUrl",
	"autolink",
	"blockquoteMarker",
	"blockquoteText",
	"listMarker",
	"orderedListMarker",
	"taskChecked",
	"taskUnchecked",
	"codeFence",
	"codeInfo",
	"codeText",
	"thematicBreak",
	"tableHeader",
	"tableCell",
	"tableBorder",
	"imageAltText",
	"imageUrl",
];

/**
 * Check whether a theme object has every required slot, making it
 * a full {@link MarkdownTheme} (as opposed to a partial override).
 */
function isFullTheme(
	theme: MarkdownTheme | Partial<MarkdownTheme>,
): theme is MarkdownTheme {
	return THEME_SLOTS.every(
		(slot) => typeof (theme as Record<string, unknown>)[slot] === "function",
	);
}

/**
 * Resolve {@link RenderOptions} into a concrete {@link RenderContext}.
 *
 * - If a full theme is provided, use it directly.
 * - If a partial theme is provided, merge it with the default using
 *   {@link createMarkdownTheme} (respecting `style` options).
 * - If no theme is provided, build the default theme with the given
 *   `style` options (or auto-detect).
 *
 * @internal
 */
export function resolveContext(options?: RenderOptions): RenderContext {
	const width = options?.width ?? 80;
	let theme: MarkdownTheme;

	if (options?.theme) {
		if (isFullTheme(options.theme)) {
			theme = options.theme;
		} else {
			// Partial theme — merge with defaults
			theme = createMarkdownTheme({
				style: options.style,
				overrides: options.theme,
			});
		}
	} else {
		// No theme — build default with style options
		theme = createMarkdownTheme({
			style: options?.style,
		});
	}

	return { theme, width, indent: "" };
}

/**
 * Render a markdown string into styled terminal output (one-shot).
 *
 * Parses the input as GitHub Flavored Markdown, walks the resulting
 * AST, and returns a fully rendered string ready to be written to
 * the terminal.
 *
 * This is the correctness baseline — streaming output from
 * {@link createMarkdownRenderer} must exactly match the output of
 * this function for the same input and options.
 *
 * @param input - Markdown source string.
 * @param options - Rendering options (width, theme, style).
 * @returns The rendered terminal output string.
 *
 * @example
 * ```ts
 * import { renderMarkdown } from "@crustjs/render";
 *
 * const output = renderMarkdown("# Hello\n\nSome **bold** text.", {
 *   width: 80,
 * });
 * process.stdout.write(output);
 * ```
 */
export function renderMarkdown(input: string, options?: RenderOptions): string {
	if (!input) return "";

	const ctx = resolveContext(options);
	const tree = parseMd(input);
	return renderBlocks(tree.children, ctx);
}
