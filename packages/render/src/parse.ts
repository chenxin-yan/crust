import type { Root } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

/**
 * Parse a markdown string into an mdast (Markdown Abstract Syntax Tree) Root node
 * with full GFM (GitHub Flavored Markdown) support.
 *
 * @param input - Markdown source string
 * @returns The parsed mdast Root node
 */
export function parseMd(input: string): Root {
	return fromMarkdown(input, {
		extensions: [gfm()],
		mdastExtensions: [gfmFromMarkdown()],
	});
}
