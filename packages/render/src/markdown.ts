// ────────────────────────────────────────────────────────────────────────────
// Markdown — Compile mdast into the shared render document IR
// ────────────────────────────────────────────────────────────────────────────

import type {
	BlockContent,
	Heading,
	List,
	ListItem,
	PhrasingContent,
	Root,
	RootContent,
	Table,
	TableRow,
} from "mdast";
import { parseMarkdown } from "./parse.ts";
import type {
	RenderBlock,
	RenderDocument,
	RenderInline,
	RenderListItem,
} from "./types.ts";

/**
 * Compile markdown into the shared render document IR.
 */
export function markdownToDocument(markdown: string): RenderDocument {
	return rootToDocument(parseMarkdown(markdown));
}

/**
 * Convert an mdast root into the shared render document IR.
 */
export function rootToDocument(root: Root): RenderDocument {
	return {
		blocks: root.children.flatMap(renderBlocksFromMdast),
	};
}

function renderBlocksFromMdast(
	node: RootContent | BlockContent,
): RenderBlock[] {
	switch (node.type) {
		case "paragraph":
			return [
				{
					type: "paragraph",
					children: renderInlineNodes(node.children),
				},
			];
		case "heading":
			return [renderHeading(node)];
		case "blockquote":
			return [
				{
					type: "blockquote",
					blocks: node.children.flatMap(renderBlocksFromMdast),
				},
			];
		case "list":
			return [renderList(node)];
		case "code":
			return [
				{
					type: "code",
					value: node.value,
					lang: node.lang ?? undefined,
					meta: node.meta ?? undefined,
				},
			];
		case "thematicBreak":
			return [{ type: "thematicBreak" }];
		case "table":
			return [renderTable(node)];
		case "html":
			return [{ type: "raw", value: node.value }];
		case "definition":
			return [];
		default:
			return [];
	}
}

function renderHeading(node: Heading): RenderBlock {
	return {
		type: "heading",
		level: node.depth,
		children: renderInlineNodes(node.children),
	};
}

function renderList(node: List): RenderBlock {
	return {
		type: "list",
		ordered: node.ordered ?? false,
		start: node.start ?? undefined,
		spread: node.spread ?? undefined,
		items: node.children.map(renderListItem),
	};
}

function renderListItem(node: ListItem): RenderListItem {
	return {
		blocks: node.children.flatMap(renderBlocksFromMdast),
		checked: typeof node.checked === "boolean" ? node.checked : undefined,
		spread: node.spread ?? undefined,
	};
}

function renderTable(node: Table): RenderBlock {
	const [headerRow, ...bodyRows] = node.children;

	return {
		type: "table",
		align: node.align?.map((value) => value ?? "left"),
		headers: headerRow ? renderTableRow(headerRow) : [],
		rows: bodyRows.map(renderTableRow),
	};
}

function renderTableRow(row: TableRow): RenderInline[][] {
	return row.children.map((cell) => renderInlineNodes(cell.children));
}

function renderInlineNodes(nodes: PhrasingContent[]): RenderInline[] {
	return nodes.flatMap<RenderInline>((node): RenderInline[] => {
		switch (node.type) {
			case "text":
				return [{ type: "text", value: node.value }];
			case "emphasis":
				return [
					{ type: "emphasis", children: renderInlineNodes(node.children) },
				];
			case "strong":
				return [{ type: "strong", children: renderInlineNodes(node.children) }];
			case "delete":
				return [
					{
						type: "strikethrough",
						children: renderInlineNodes(node.children),
					},
				];
			case "inlineCode":
				return [{ type: "inlineCode", value: node.value }];
			case "link": {
				const children = renderInlineNodes(node.children);
				const plainText = flattenInlineText(children).trim();
				if (plainText === node.url.trim()) {
					return [{ type: "autolink", url: node.url }];
				}
				return [{ type: "link", url: node.url, children }];
			}
			case "linkReference":
				return [
					{
						type: "link",
						url: `[${node.identifier}]`,
						children:
							node.children.length > 0
								? renderInlineNodes(node.children)
								: [{ type: "text", value: node.identifier }],
					},
				];
			case "image":
				return [
					{
						type: "image",
						alt: node.alt?.trim() || "image",
						url: node.url,
					},
				];
			case "imageReference":
				return [
					{
						type: "image",
						alt: node.alt?.trim() || node.identifier || "image",
						url: `[${node.identifier}]`,
					},
				];
			case "break":
				return [{ type: "break" }];
			case "html":
				return [{ type: "raw", value: node.value }];
			default:
				return [];
		}
	});
}

function flattenInlineText(nodes: RenderInline[]): string {
	return nodes
		.map((node) => {
			switch (node.type) {
				case "text":
				case "inlineCode":
				case "raw":
					return node.value;
				case "emphasis":
				case "strong":
				case "strikethrough":
				case "link":
					return flattenInlineText(node.children);
				case "autolink":
					return node.url;
				case "image":
					return node.alt;
				case "break":
					return " ";
				default:
					return "";
			}
		})
		.join("");
}
