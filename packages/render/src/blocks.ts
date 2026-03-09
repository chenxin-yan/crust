// ────────────────────────────────────────────────────────────────────────────
// Blocks — Generic document rendering for @crustjs/render
// ────────────────────────────────────────────────────────────────────────────

import {
	type ColumnAlignment,
	type MarkdownTheme,
	table,
	visibleWidth,
	wrapText,
} from "@crustjs/style";
import { renderInline } from "./inline.ts";
import type {
	RenderBlock,
	RenderHeading,
	RenderList,
	RenderListItem,
	RenderTable,
} from "./types.ts";

/**
 * Shared rendering state for block renderers.
 */
export interface RenderContext {
	readonly theme: MarkdownTheme;
	readonly width: number;
	readonly indent: number;
}

/**
 * Render an array of generic block nodes into a terminal-friendly string.
 */
export function renderBlocks(
	nodes: RenderBlock[],
	context: RenderContext,
	options?: { readonly tight?: boolean },
): string {
	const rendered = nodes
		.map((node) => renderBlock(node, context))
		.filter((value) => value.length > 0);

	return rendered.join(options?.tight ? "\n" : "\n\n");
}

function renderBlock(node: RenderBlock, context: RenderContext): string {
	switch (node.type) {
		case "paragraph":
			return wrapBlock(
				renderInline(node.children, context.theme),
				context.width,
				" ".repeat(context.indent),
			);
		case "heading":
			return renderHeading(node, context);
		case "blockquote":
			return renderBlockquote(node.blocks, context);
		case "list":
			return renderList(node, context);
		case "code":
			return renderCode(node.value, node.lang, node.meta, context);
		case "thematicBreak":
			return renderThematicBreak(context);
		case "table":
			return renderTable(node, context);
		case "raw":
			return indentBlock(node.value, context.indent);
		default:
			return "";
	}
}

function renderHeading(node: RenderHeading, context: RenderContext): string {
	const marker = `${"#".repeat(node.level)} `;
	const themed = applyHeadingTheme(
		node.level,
		renderInline(node.children, context.theme),
		context.theme,
	);
	const baseIndent = " ".repeat(context.indent);
	return wrapBlock(
		themed,
		context.width,
		baseIndent + marker,
		baseIndent + " ".repeat(marker.length),
	);
}

function renderBlockquote(
	blocks: RenderBlock[],
	context: RenderContext,
): string {
	const quoted = renderBlocks(blocks, {
		...context,
		indent: context.indent + 2,
	});
	const baseIndent = " ".repeat(context.indent);
	const quoteMarker = context.theme.blockquoteMarker(">");

	return quoted
		.split("\n")
		.map((line) => {
			const innerIndent = " ".repeat(context.indent + 2);
			if (line.length === 0) {
				return `${baseIndent}${quoteMarker}`;
			}
			if (line.startsWith(innerIndent)) {
				return `${baseIndent}${quoteMarker} ${line.slice(innerIndent.length)}`;
			}
			return `${baseIndent}${quoteMarker} ${line.trimStart()}`;
		})
		.join("\n");
}

function renderList(node: RenderList, context: RenderContext): string {
	const start = node.start ?? 1;
	const orderedMarkerWidth = node.ordered
		? `${start + node.items.length - 1}.`.length
		: 0;

	return node.items
		.map((item, index) =>
			renderListItem(item, {
				...context,
				list: node,
				index,
				start,
				orderedMarkerWidth,
			}),
		)
		.join("\n");
}

function renderListItem(
	item: RenderListItem,
	config: RenderContext & {
		readonly list: RenderList;
		readonly index: number;
		readonly start: number;
		readonly orderedMarkerWidth: number;
	},
): string {
	const marker = resolveListMarker(item, config);
	const gap = " ";
	const markerWidth = visibleWidth(marker);
	const contentIndent = markerWidth + gap.length;
	const content = renderBlocks(
		item.blocks,
		{
			theme: config.theme,
			width: config.width,
			indent: config.indent + contentIndent,
		},
		{
			tight: !(item.spread ?? config.list.spread ?? false),
		},
	);

	if (content.length === 0) {
		return `${" ".repeat(config.indent)}${marker}`;
	}

	const lines = content.split("\n");
	const expectedIndent = " ".repeat(config.indent + contentIndent);
	const firstLine = lines[0] ?? "";
	const normalizedFirst = firstLine.startsWith(expectedIndent)
		? firstLine.slice(expectedIndent.length)
		: firstLine.trimStart();

	lines[0] = `${" ".repeat(config.indent)}${marker}${gap}${normalizedFirst}`;
	return lines.join("\n");
}

function renderCode(
	value: string,
	lang: string | undefined,
	meta: string | undefined,
	context: RenderContext,
): string {
	const indent = " ".repeat(context.indent);
	const fence = context.theme.codeFence("```");
	const info = lang
		? ` ${context.theme.codeInfo(meta ? `${lang} ${meta}` : lang)}`
		: "";
	const lines = value
		.split("\n")
		.map((line) => `${indent}${context.theme.codeText(line)}`);

	return [`${indent}${fence}${info}`, ...lines, `${indent}${fence}`].join("\n");
}

function renderThematicBreak(context: RenderContext): string {
	const available = Math.max(3, Math.min(40, context.width - context.indent));
	return `${" ".repeat(context.indent)}${context.theme.thematicBreak("-".repeat(available))}`;
}

function renderTable(node: RenderTable, context: RenderContext): string {
	if (node.headers.length === 0) {
		return "";
	}

	const headers = node.headers.map((cell) =>
		context.theme.tableHeader(renderTableCell(cell, context.theme)),
	);
	const rows = node.rows.map((row) =>
		row.map((cell) =>
			context.theme.tableCell(renderTableCell(cell, context.theme)),
		),
	);
	const align = (node.align ?? []).map(
		(value) => (value ?? "left") as ColumnAlignment,
	);
	const rendered = table(headers, rows, {
		align,
		borderChar: context.theme.tableBorder("|"),
		separatorChar: context.theme.tableBorder("-"),
	});

	return indentBlock(rendered, context.indent);
}

function renderTableCell(
	cell: RenderTable["headers"][number],
	theme: MarkdownTheme,
): string {
	return renderInline(cell, theme).replaceAll("\n", " ").trim();
}

function applyHeadingTheme(
	depth: RenderHeading["level"],
	value: string,
	theme: MarkdownTheme,
): string {
	switch (depth) {
		case 1:
			return theme.heading1(value);
		case 2:
			return theme.heading2(value);
		case 3:
			return theme.heading3(value);
		case 4:
			return theme.heading4(value);
		case 5:
			return theme.heading5(value);
		default:
			return theme.heading6(value);
	}
}

function resolveListMarker(
	item: RenderListItem,
	config: RenderContext & {
		readonly list: RenderList;
		readonly index: number;
		readonly start: number;
		readonly orderedMarkerWidth: number;
	},
): string {
	if (typeof item.checked === "boolean") {
		return item.checked
			? config.theme.taskChecked("[x]")
			: config.theme.taskUnchecked("[ ]");
	}

	if (config.list.ordered) {
		const value = `${config.start + config.index}.`.padStart(
			config.orderedMarkerWidth,
			" ",
		);
		return config.theme.orderedListMarker(value);
	}

	return config.theme.listMarker("-");
}

function wrapBlock(
	text: string,
	width: number,
	firstPrefix: string,
	restPrefix = firstPrefix,
): string {
	const availableWidth = Math.max(
		1,
		width - Math.max(visibleWidth(firstPrefix), visibleWidth(restPrefix)),
	);
	const wrapped = wrapText(text, availableWidth);

	return wrapped
		.split("\n")
		.map((line, index) => `${index === 0 ? firstPrefix : restPrefix}${line}`)
		.join("\n");
}

function indentBlock(text: string, indent: number): string {
	const prefix = " ".repeat(indent);
	return text
		.split("\n")
		.map((line) => `${prefix}${line}`)
		.join("\n");
}
