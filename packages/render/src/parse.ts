// ────────────────────────────────────────────────────────────────────────────
// Parse — Markdown parsing with GFM support
// ────────────────────────────────────────────────────────────────────────────

import type { Root } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

/**
 * Parse markdown into an mdast root with GitHub Flavored Markdown enabled.
 */
export function parseMarkdown(markdown: string): Root {
	return fromMarkdown(markdown, {
		extensions: [gfm()],
		mdastExtensions: [gfmFromMarkdown()],
	});
}
