// ────────────────────────────────────────────────────────────────────────────
// Render — Shared document serializer and markdown convenience entry points
// ────────────────────────────────────────────────────────────────────────────

import { renderBlocks } from "./blocks.ts";
import { markdownToDocument } from "./markdown.ts";
import {
	resolveRenderMarkdownOptions,
	resolveRenderOptions,
} from "./options.ts";
import type {
	RenderDocument,
	RenderDocumentOptions,
	RenderMarkdownOptions,
} from "./types.ts";

/**
 * Render a generic document IR into a terminal-friendly string.
 */
export function renderDocument(
	document: RenderDocument,
	options?: RenderDocumentOptions,
): string {
	const resolved = resolveRenderOptions(options);

	return renderBlocks(document.blocks, {
		theme: resolved.theme,
		width: resolved.width,
		indent: resolved.indent,
	});
}

/**
 * Render markdown into a terminal-friendly string.
 */
export function renderMarkdown(
	markdown: string,
	options?: RenderMarkdownOptions,
): string {
	const resolved = resolveRenderMarkdownOptions(options);
	const document = markdownToDocument(markdown);
	const rendered = renderDocument(document, resolved);

	if (
		resolved.preserveTrailingNewline &&
		markdown.endsWith("\n") &&
		!rendered.endsWith("\n")
	) {
		return `${rendered}\n`;
	}

	return rendered;
}
