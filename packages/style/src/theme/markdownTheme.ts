// ────────────────────────────────────────────────────────────────────────────
// Markdown Theme — Semantic theme slot definitions for GFM presentation
// ────────────────────────────────────────────────────────────────────────────

import type { StyleInstance } from "../types.ts";
/**
 * A style function that transforms a string for themed terminal output.
 *
 * Theme slot functions are pure string-in/string-out transformers.
 * They may apply ANSI styling, add structural markers, or return
 * the input unchanged — depending on the theme configuration and
 * color mode.
 */
export type ThemeSlotFn = (value: string) => string;

/**
 * Semantic theme contract for GitHub Flavored Markdown (GFM) presentation.
 *
 * Each slot corresponds to a distinct GFM construct. A markdown renderer
 * maps parsed AST nodes to these slots to produce styled terminal output.
 * The theme itself is parser-agnostic — it only defines how to style
 * already-extracted text for each construct.
 *
 * All slots are `string => string` functions. When colors are disabled,
 * slots should preserve textual structure and readability without ANSI codes.
 *
 * @example
 * ```ts
 * import { defaultTheme } from "@crustjs/style";
 *
 * // Use theme slots to style extracted markdown content
 * const styled = defaultTheme.heading1("Introduction");
 * console.log(styled); // Bold + underlined "Introduction"
 * ```
 */
export interface MarkdownTheme {
	// ── Block: Headings ────────────────────────────────────────────────────

	/** ATX heading level 1 text. */
	readonly heading1: ThemeSlotFn;

	/** ATX heading level 2 text. */
	readonly heading2: ThemeSlotFn;

	/** ATX heading level 3 text. */
	readonly heading3: ThemeSlotFn;

	/** ATX heading level 4 text. */
	readonly heading4: ThemeSlotFn;

	/** ATX heading level 5 text. */
	readonly heading5: ThemeSlotFn;

	/** ATX heading level 6 text. */
	readonly heading6: ThemeSlotFn;

	// ── Block: Body text ──────────────────────────────────────────────────

	/** Default paragraph / body text. */
	readonly text: ThemeSlotFn;

	// ── Inline: Emphasis ──────────────────────────────────────────────────

	/** Italic emphasis (`*text*` or `_text_`). */
	readonly emphasis: ThemeSlotFn;

	/** Bold / strong emphasis (`**text**` or `__text__`). */
	readonly strong: ThemeSlotFn;

	/** Bold + italic (`***text***`). */
	readonly strongEmphasis: ThemeSlotFn;

	/** Strikethrough (`~~text~~`). */
	readonly strikethrough: ThemeSlotFn;

	// ── Inline: Code ──────────────────────────────────────────────────────

	/** Inline code span (`` `code` ``). */
	readonly inlineCode: ThemeSlotFn;

	// ── Inline: Links ─────────────────────────────────────────────────────

	/** Link display text (`[text](url)`). */
	readonly linkText: ThemeSlotFn;

	/** Link destination URL. */
	readonly linkUrl: ThemeSlotFn;

	/** Autolink display text (`<https://...>`). */
	readonly autolink: ThemeSlotFn;

	// ── Block: Blockquotes ────────────────────────────────────────────────

	/** Blockquote prefix/marker (e.g. `>`). */
	readonly blockquoteMarker: ThemeSlotFn;

	/** Blockquote body text content. */
	readonly blockquoteText: ThemeSlotFn;

	// ── Block: Lists ──────────────────────────────────────────────────────

	/** Unordered list bullet marker. */
	readonly listMarker: ThemeSlotFn;

	/** Ordered list number marker (e.g. `1.`). */
	readonly orderedListMarker: ThemeSlotFn;

	/** Task list checked marker (e.g. `[x]`). */
	readonly taskChecked: ThemeSlotFn;

	/** Task list unchecked marker (e.g. `[ ]`). */
	readonly taskUnchecked: ThemeSlotFn;

	// ── Block: Code blocks ────────────────────────────────────────────────

	/** Code fence delimiter (e.g. ` ``` `). */
	readonly codeFence: ThemeSlotFn;

	/** Code block info string / language label. */
	readonly codeInfo: ThemeSlotFn;

	/** Code block body text. */
	readonly codeText: ThemeSlotFn;

	// ── Block: Thematic breaks ────────────────────────────────────────────

	/** Thematic break / horizontal rule. */
	readonly thematicBreak: ThemeSlotFn;

	// ── Block: Tables ─────────────────────────────────────────────────────

	/** Table header cell text. */
	readonly tableHeader: ThemeSlotFn;

	/** Table body cell text. */
	readonly tableCell: ThemeSlotFn;

	/** Table border / separator characters. */
	readonly tableBorder: ThemeSlotFn;

	// ── Inline: Images ────────────────────────────────────────────────────

	/** Image alt text. */
	readonly imageAltText: ThemeSlotFn;

	/** Image URL / destination. */
	readonly imageUrl: ThemeSlotFn;
}

/**
 * Partial theme override type for {@link createTheme}.
 *
 * Allows overriding any subset of theme slots while inheriting
 * defaults for the rest.
 */
export type PartialMarkdownTheme = Partial<MarkdownTheme>;

/**
 * Build a default {@link MarkdownTheme} from a {@link StyleInstance}.
 *
 * The returned theme uses the style instance's modifier and color functions,
 * so color emission respects the instance's configured mode (`auto` / `always`
 * / `never`). When colors are disabled the slots return the input unchanged
 * (identity functions), preserving textual structure and readability.
 *
 * @param s - The style instance to derive theme functions from.
 * @returns A frozen {@link MarkdownTheme} with readable default styles.
 *
 * @example
 * ```ts
 * import { createStyle } from "@crustjs/style";
 * import { buildDefaultTheme } from "./defaultTheme.ts";
 *
 * const theme = buildDefaultTheme(createStyle({ mode: "always" }));
 * console.log(theme.heading1("Title")); // bold + underlined
 * ```
 */
export function buildDefaultMarkdownTheme(s: StyleInstance): MarkdownTheme {
	const theme: MarkdownTheme = {
		// ── Headings ──────────────────────────────────────────────────────
		// Level 1: bold + underline for maximum emphasis
		// Level 2: bold
		// Levels 3-6: progressively less emphasis

		heading1: (value) => s.bold(s.underline(value)),
		heading2: (value) => s.bold(value),
		heading3: (value) => s.bold(s.yellow(value)),
		heading4: (value) => s.yellow(value),
		heading5: (value) => s.dim(s.yellow(value)),
		heading6: (value) => s.dim(value),

		// ── Body text ─────────────────────────────────────────────────────

		text: (value) => value,

		// ── Inline emphasis ───────────────────────────────────────────────

		emphasis: (value) => s.italic(value),
		strong: (value) => s.bold(value),
		strongEmphasis: (value) => s.bold(s.italic(value)),
		strikethrough: (value) => s.strikethrough(value),

		// ── Inline code ───────────────────────────────────────────────────

		inlineCode: (value) => s.cyan(value),

		// ── Links ─────────────────────────────────────────────────────────

		linkText: (value) => s.blue(s.underline(value)),
		linkUrl: (value) => s.dim(s.underline(value)),
		autolink: (value) => s.blue(s.underline(value)),

		// ── Blockquotes ───────────────────────────────────────────────────

		blockquoteMarker: (value) => s.dim(s.green(value)),
		blockquoteText: (value) => s.italic(value),

		// ── Lists ─────────────────────────────────────────────────────────

		listMarker: (value) => s.dim(value),
		orderedListMarker: (value) => s.dim(value),
		taskChecked: (value) => s.green(value),
		taskUnchecked: (value) => s.dim(value),

		// ── Code blocks ───────────────────────────────────────────────────

		codeFence: (value) => s.dim(value),
		codeInfo: (value) => s.dim(s.italic(value)),
		codeText: (value) => s.cyan(value),

		// ── Thematic breaks ───────────────────────────────────────────────

		thematicBreak: (value) => s.dim(value),

		// ── Tables ────────────────────────────────────────────────────────

		tableHeader: (value) => s.bold(value),
		tableCell: (value) => value,
		tableBorder: (value) => s.dim(value),

		// ── Images ────────────────────────────────────────────────────────

		imageAltText: (value) => s.italic(s.magenta(value)),
		imageUrl: (value) => s.dim(s.underline(value)),
	};

	return Object.freeze(theme);
}
