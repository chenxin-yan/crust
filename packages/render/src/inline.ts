// ────────────────────────────────────────────────────────────────────────────
// Inline — Generic inline-document rendering for @crustjs/render
// ────────────────────────────────────────────────────────────────────────────

import type { MarkdownTheme } from "@crustjs/style";
import type { RenderInline } from "./types.ts";

/**
 * Render generic inline nodes into a terminal-friendly string.
 */
export function renderInline(
	nodes: RenderInline[],
	theme: MarkdownTheme,
): string {
	return nodes.map((node) => renderInlineNode(node, theme)).join("");
}

/**
 * Extract unstyled text content from generic inline nodes.
 */
export function extractPlainText(nodes: RenderInline[]): string {
	return nodes.map((node) => extractPlainTextFromNode(node)).join("");
}

function renderInlineNode(node: RenderInline, theme: MarkdownTheme): string {
	switch (node.type) {
		case "text":
			return theme.text(node.value);
		case "emphasis":
			return `_${theme.emphasis(renderInline(node.children, theme))}_`;
		case "strong":
			return `**${theme.strong(renderInline(node.children, theme))}**`;
		case "strikethrough":
			return `~~${theme.strikethrough(renderInline(node.children, theme))}~~`;
		case "inlineCode":
			return renderInlineCode(node.value, theme);
		case "link":
			return renderLink(node.url, node.children, theme);
		case "autolink":
			return theme.autolink(`<${node.url}>`);
		case "image":
			return renderImage(node.alt, node.url, theme);
		case "break":
			return "\n";
		case "raw":
			return node.value;
		default:
			return "";
	}
}

function renderInlineCode(value: string, theme: MarkdownTheme): string {
	const fence = codeTicks(value);
	return `${fence}${theme.inlineCode(value)}${fence}`;
}

function renderLink(
	url: string,
	children: RenderInline[],
	theme: MarkdownTheme,
): string {
	const label = renderInline(children, theme) || theme.linkText(url);
	return `${theme.linkText(label)} ${theme.linkUrl(`(${url})`)}`;
}

function renderImage(alt: string, url: string, theme: MarkdownTheme): string {
	return `${theme.imageAltText(`[image: ${alt}]`)} ${theme.imageUrl(`(${url})`)}`;
}

function extractPlainTextFromNode(node: RenderInline): string {
	switch (node.type) {
		case "text":
		case "inlineCode":
		case "raw":
			return node.value;
		case "emphasis":
		case "strong":
		case "strikethrough":
		case "link":
			return extractPlainText(node.children);
		case "autolink":
			return node.url;
		case "image":
			return node.alt;
		case "break":
			return " ";
		default:
			return "";
	}
}

function codeTicks(value: string): string {
	const matches = value.match(/`+/g);
	const longest =
		matches?.reduce((max, run) => Math.max(max, run.length), 0) ?? 0;
	return "`".repeat(longest + 1);
}
