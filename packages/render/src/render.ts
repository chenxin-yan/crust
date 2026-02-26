// ────────────────────────────────────────────────────────────────────────────
// Render — mdast-to-terminal tree walker
// ────────────────────────────────────────────────────────────────────────────

import type {
	Delete,
	Emphasis,
	Image,
	InlineCode,
	Link,
	PhrasingContent,
	Strong,
	Text,
} from "mdast";
import type { RenderContext } from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Inline rendering
// ────────────────────────────────────────────────────────────────────────────

/**
 * Render an array of inline (phrasing) mdast nodes into a styled string.
 *
 * Walks the inline node tree recursively, applying the appropriate theme
 * slot function for each node type. Inline rendering is string-in/string-out
 * with no newlines except for explicit `break` nodes.
 *
 * @param nodes - Array of mdast phrasing content nodes.
 * @param ctx - The rendering context with theme and width.
 * @returns The rendered inline string.
 */
export function renderInline(
	nodes: PhrasingContent[],
	ctx: RenderContext,
): string {
	let result = "";
	for (const node of nodes) {
		result += renderInlineNode(node, ctx);
	}
	return result;
}

/**
 * Render a single inline mdast node into a styled string.
 *
 * Handles all GFM inline constructs: text, emphasis, strong,
 * strong+emphasis nesting, strikethrough, inline code, links,
 * autolinks, images, and hard breaks.
 */
function renderInlineNode(node: PhrasingContent, ctx: RenderContext): string {
	const { theme } = ctx;

	switch (node.type) {
		case "text":
			return theme.text((node as Text).value);

		case "emphasis":
			return renderEmphasis(node as Emphasis, ctx);

		case "strong":
			return renderStrong(node as Strong, ctx);

		case "delete":
			return theme.strikethrough(renderInline((node as Delete).children, ctx));

		case "inlineCode":
			return theme.inlineCode((node as InlineCode).value);

		case "link":
			return renderLink(node as Link, ctx);

		case "image":
			return renderImage(node as Image, ctx);

		case "break":
			return "\n";

		default:
			// Unknown inline node — render children if present, otherwise empty
			if ("children" in node && Array.isArray(node.children)) {
				return renderInline(node.children as PhrasingContent[], ctx);
			}
			if ("value" in node && typeof node.value === "string") {
				return node.value;
			}
			return "";
	}
}

// ────────────────────────────────────────────────────────────────────────────
// Inline node helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Render an emphasis node, detecting strong+emphasis nesting to apply
 * the `strongEmphasis` theme slot when appropriate.
 *
 * mdast parses `***text***` as `emphasis > strong > text`. When an emphasis
 * node contains a single strong child, we apply `strongEmphasis` to the
 * inner text instead of nesting `emphasis(strong(text))`.
 */
function renderEmphasis(node: Emphasis, ctx: RenderContext): string {
	const { theme } = ctx;

	// Detect emphasis wrapping a single strong node: ***text***
	if (node.children.length === 1 && node.children[0]?.type === "strong") {
		const strongNode = node.children[0] as Strong;
		const innerText = renderInline(strongNode.children, ctx);
		return theme.strongEmphasis(innerText);
	}

	return theme.emphasis(renderInline(node.children, ctx));
}

/**
 * Render a strong node, detecting emphasis+strong nesting to apply
 * the `strongEmphasis` theme slot when appropriate.
 *
 * Some parsers may produce `strong > emphasis > text` instead of
 * `emphasis > strong > text`. Handle both orderings.
 */
function renderStrong(node: Strong, ctx: RenderContext): string {
	const { theme } = ctx;

	// Detect strong wrapping a single emphasis node
	if (node.children.length === 1 && node.children[0]?.type === "emphasis") {
		const emphasisNode = node.children[0] as Emphasis;
		const innerText = renderInline(emphasisNode.children, ctx);
		return theme.strongEmphasis(innerText);
	}

	return theme.strong(renderInline(node.children, ctx));
}

/**
 * Render a link node, detecting autolinks (where the display text
 * equals the URL) to apply the `autolink` theme slot.
 *
 * For regular links, renders as: `linkText(text) linkUrl((url))`
 */
function renderLink(node: Link, ctx: RenderContext): string {
	const { theme } = ctx;
	const childText = renderInline(node.children, ctx);

	// Autolink: display text matches URL
	if (childText === node.url) {
		return theme.autolink(node.url);
	}

	return `${theme.linkText(childText)} ${theme.linkUrl(`(${node.url})`)}`;
}

/**
 * Render an image node as alt text + URL.
 *
 * Images cannot be rendered inline in the terminal, so we display
 * the alt text and URL as styled text.
 */
function renderImage(node: Image, ctx: RenderContext): string {
	const { theme } = ctx;
	const alt = node.alt || "";
	return `${theme.imageAltText(alt)} ${theme.imageUrl(`(${node.url})`)}`;
}
