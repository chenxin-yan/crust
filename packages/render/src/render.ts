// ────────────────────────────────────────────────────────────────────────────
// Render — mdast-to-terminal tree walker
// ────────────────────────────────────────────────────────────────────────────

import {
	orderedList as formatOrderedList,
	table as formatTable,
	taskList as formatTaskList,
	unorderedList as formatUnorderedList,
	visibleWidth,
	wrapText,
} from "@crustjs/style";
import type {
	Blockquote,
	Code,
	Delete,
	Emphasis,
	Heading,
	Html,
	Image,
	InlineCode,
	Link,
	List,
	ListItem,
	Paragraph,
	PhrasingContent,
	RootContent,
	Strong,
	Table,
	TableCell,
	TableRow,
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

// ────────────────────────────────────────────────────────────────────────────
// Block rendering
// ────────────────────────────────────────────────────────────────────────────

/**
 * Render an array of block-level mdast nodes (root children) into
 * styled terminal output.
 *
 * Top-level blocks are separated by blank lines (`\n\n`).
 *
 * @param nodes - Array of mdast root content nodes.
 * @param ctx - The rendering context.
 * @returns The fully rendered block output.
 */
export function renderBlocks(nodes: RootContent[], ctx: RenderContext): string {
	const parts: string[] = [];
	for (const node of nodes) {
		const rendered = renderBlockNode(node, ctx);
		if (rendered !== "") {
			parts.push(rendered);
		}
	}
	return parts.join("\n\n");
}

/**
 * Render a single block-level mdast node into a styled string.
 */
function renderBlockNode(node: RootContent, ctx: RenderContext): string {
	switch (node.type) {
		case "heading":
			return renderHeading(node as Heading, ctx);
		case "paragraph":
			return renderParagraph(node as Paragraph, ctx);
		case "blockquote":
			return renderBlockquote(node as Blockquote, ctx);
		case "code":
			return renderCodeBlock(node as Code, ctx);
		case "thematicBreak":
			return renderThematicBreak(ctx);
		case "list":
			return renderList(node as List, ctx);
		case "table":
			return renderTable(node as Table, ctx);
		case "html":
			return (node as Html).value;
		default:
			// Unknown block — render children if present, value if literal
			if ("children" in node && Array.isArray(node.children)) {
				return renderBlocks(node.children as RootContent[], ctx);
			}
			if ("value" in node && typeof node.value === "string") {
				return node.value;
			}
			return "";
	}
}

// ────────────────────────────────────────────────────────────────────────────
// Block node helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Map heading depth (1-6) to the corresponding theme slot.
 */
const HEADING_SLOTS = [
	"heading1",
	"heading2",
	"heading3",
	"heading4",
	"heading5",
	"heading6",
] as const;

/**
 * Render a heading node (levels 1-6).
 *
 * Applies the corresponding theme.heading{N} slot to the rendered
 * inline children.
 */
function renderHeading(node: Heading, ctx: RenderContext): string {
	const { theme } = ctx;
	const inlineText = renderInline(node.children, ctx);
	const slot = HEADING_SLOTS[node.depth - 1] ?? "heading1";
	return theme[slot](inlineText);
}

/**
 * Render a paragraph node.
 *
 * Renders inline children, then wraps to the configured width
 * respecting current indentation.
 */
function renderParagraph(node: Paragraph, ctx: RenderContext): string {
	const inlineText = renderInline(node.children, ctx);
	const availableWidth = Math.max(1, ctx.width - visibleWidth(ctx.indent));
	const wrapped = wrapText(inlineText, availableWidth);
	return applyIndent(wrapped, ctx.indent);
}

/**
 * Render a blockquote node.
 *
 * Prefixes each line with the blockquote marker and applies
 * blockquoteText styling to body content. Handles nested blockquotes
 * by adjusting the indent and available width.
 */
function renderBlockquote(node: Blockquote, ctx: RenderContext): string {
	const { theme } = ctx;
	const marker = theme.blockquoteMarker("> ");

	// Create a nested context with the blockquote marker as additional indent
	const nestedCtx: RenderContext = {
		...ctx,
		indent: "",
		width: Math.max(
			1,
			ctx.width - visibleWidth(ctx.indent) - visibleWidth(marker),
		),
	};

	// Render the blockquote's children as blocks
	const bodyParts: string[] = [];
	for (const child of node.children) {
		const rendered = renderBlockNode(child as RootContent, nestedCtx);
		if (rendered !== "") {
			bodyParts.push(rendered);
		}
	}
	const body = bodyParts.join("\n\n");

	// Apply blockquoteText styling and prefix each line with marker
	const styledBody = theme.blockquoteText(body);
	const lines = styledBody.split("\n");
	const prefixed = lines
		.map((line) => `${ctx.indent}${marker}${line}`)
		.join("\n");
	return prefixed;
}

/**
 * Render a fenced code block.
 *
 * Emits the opening fence with optional language info, each line of
 * code body styled through theme.codeText, and a closing fence.
 */
function renderCodeBlock(node: Code, ctx: RenderContext): string {
	const { theme } = ctx;
	const fence = theme.codeFence("```");
	const info = node.lang ? theme.codeInfo(node.lang) : "";
	const header = info ? `${fence}${info}` : fence;

	const lines = node.value.split("\n");
	const bodyLines = lines.map((line) => theme.codeText(line));
	const closingFence = theme.codeFence("```");

	const allLines = [header, ...bodyLines, closingFence];
	return applyIndent(allLines.join("\n"), ctx.indent);
}

/**
 * Render a thematic break (horizontal rule).
 *
 * Fills the available width with a horizontal line character.
 */
function renderThematicBreak(ctx: RenderContext): string {
	const { theme } = ctx;
	const availableWidth = Math.max(1, ctx.width - visibleWidth(ctx.indent));
	const rule = "─".repeat(availableWidth);
	return `${ctx.indent}${theme.thematicBreak(rule)}`;
}

/**
 * Render a list node (unordered, ordered, or task list).
 *
 * Detects task lists by checking if any list item has a non-null
 * `checked` property. Delegates to the appropriate list helper.
 */
function renderList(node: List, ctx: RenderContext): string {
	const items = node.children as ListItem[];

	// Detect task list: at least one item has a boolean checked property
	const isTaskList = items.some((item) => typeof item.checked === "boolean");

	if (isTaskList) {
		return renderTaskList(items, ctx);
	}

	if (node.ordered) {
		return renderOrderedList(items, node.start ?? 1, ctx);
	}

	return renderUnorderedList(items, ctx);
}

/**
 * Render an unordered list.
 *
 * Uses theme.listMarker for bullet markers, with proper indentation
 * for continuation lines and nested lists.
 */
function renderUnorderedList(items: ListItem[], ctx: RenderContext): string {
	const { theme } = ctx;
	const marker = theme.listMarker("•");
	const prefixWidth = visibleWidth(marker) + 1;
	const renderedItems = items.map((item) =>
		renderListItemContent(item, ctx, prefixWidth),
	);

	return applyIndent(
		formatUnorderedList(renderedItems, {
			marker,
			markerGap: 1,
		}),
		ctx.indent,
	);
}

/**
 * Render an ordered list.
 *
 * Uses theme.orderedListMarker for number markers, with proper
 * alignment based on the widest marker.
 */
function renderOrderedList(
	items: ListItem[],
	start: number,
	ctx: RenderContext,
): string {
	const { theme } = ctx;
	const maxNum = start + items.length - 1;
	const prefixWidth = visibleWidth(`${maxNum}.`) + 1;
	const renderedItems = items.map((item) =>
		renderListItemContent(item, ctx, prefixWidth),
	);

	return applyIndent(
		formatOrderedList(renderedItems, {
			start,
			markerGap: 1,
			markerFormatter: theme.orderedListMarker,
		}),
		ctx.indent,
	);
}

/**
 * Render a task list.
 *
 * Uses theme.taskChecked/taskUnchecked for markers.
 */
function renderTaskList(items: ListItem[], ctx: RenderContext): string {
	const { theme } = ctx;
	const checkedMarker = theme.taskChecked("[x]");
	const uncheckedMarker = theme.taskUnchecked("[ ]");
	const prefixWidth =
		Math.max(visibleWidth(checkedMarker), visibleWidth(uncheckedMarker)) + 1;

	const renderedItems = items.map((item) =>
		renderListItemContent(item, ctx, prefixWidth),
	);
	const taskItems = items.map((item, index) => ({
		text: renderedItems[index] ?? "",
		checked: item.checked === true,
	}));

	return applyIndent(
		formatTaskList(taskItems, {
			checkedMarker,
			uncheckedMarker,
			markerGap: 1,
		}),
		ctx.indent,
	);
}

/**
 * Render the content of a list item.
 *
 * List items can contain paragraphs, nested lists, code blocks, etc.
 * This renders all children and joins them appropriately, reducing
 * the available width by the marker prefix width.
 */
function renderListItemContent(
	item: ListItem,
	ctx: RenderContext,
	prefixWidth: number,
): string {
	const nestedCtx: RenderContext = {
		...ctx,
		indent: "",
		width: Math.max(1, ctx.width - visibleWidth(ctx.indent) - prefixWidth),
	};

	const parts: string[] = [];
	for (const child of item.children) {
		if (child.type === "paragraph") {
			// For paragraphs inside list items, render inline content and wrap
			const inlineText = renderInline((child as Paragraph).children, nestedCtx);
			const wrapped = wrapText(inlineText, nestedCtx.width);
			parts.push(wrapped);
		} else {
			// For other blocks (nested lists, code blocks, etc.)
			const rendered = renderBlockNode(child as RootContent, nestedCtx);
			if (rendered !== "") {
				parts.push(rendered);
			}
		}
	}

	return parts.join("\n");
}

/**
 * Render a GFM table.
 *
 * Extracts header and body cells, computes column widths using
 * visibleWidth, and applies theme.tableHeader/tableCell/tableBorder
 * for styling.
 */
function renderTable(node: Table, ctx: RenderContext): string {
	const { theme } = ctx;
	const rows = node.children as TableRow[];
	if (rows.length === 0) return "";

	const headerRow = rows[0];
	if (!headerRow) return "";
	const bodyRows = rows.slice(1);

	// Column alignment from the table node
	const alignments = (node.align ?? []).map((align) =>
		align === "left" || align === "center" || align === "right"
			? align
			: "left",
	);

	// Extract and render cell contents
	const headerCells = (headerRow.children as TableCell[]).map((cell) =>
		renderInline(cell.children, ctx),
	);

	const bodyCells = bodyRows.map((row) =>
		(row.children as TableCell[]).map((cell) =>
			renderInline(cell.children, ctx),
		),
	);

	const rendered = formatTable(
		headerCells.map((cell) => theme.tableHeader(cell)),
		bodyCells.map((row) => row.map((cell) => theme.tableCell(cell))),
		{
			align: alignments,
			separatorChar: theme.tableBorder("─"),
			borderChar: theme.tableBorder("|"),
		},
	);

	return applyIndent(rendered, ctx.indent);
}

// ────────────────────────────────────────────────────────────────────────────
// Utilities
// ────────────────────────────────────────────────────────────────────────────

/**
 * Apply an indentation prefix to every line of a multi-line string.
 */
function applyIndent(text: string, indent: string): string {
	if (!indent) return text;
	return text
		.split("\n")
		.map((line) => `${indent}${line}`)
		.join("\n");
}
