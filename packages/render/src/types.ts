// ────────────────────────────────────────────────────────────────────────────
// Types — Shared public types for @crustjs/render
// ────────────────────────────────────────────────────────────────────────────

import type { CreateMarkdownThemeOptions, MarkdownTheme } from "@crustjs/style";

/**
 * Generic render document consumed by the terminal serializer.
 */
export interface RenderDocument {
	readonly blocks: RenderBlock[];
}

/**
 * A terminal-oriented block node.
 */
export type RenderBlock =
	| RenderParagraph
	| RenderHeading
	| RenderBlockquote
	| RenderList
	| RenderCodeBlock
	| RenderThematicBreak
	| RenderTable
	| RenderRawBlock;

/**
 * A terminal-oriented inline node.
 */
export type RenderInline =
	| RenderText
	| RenderEmphasis
	| RenderStrong
	| RenderStrikethrough
	| RenderInlineCode
	| RenderLink
	| RenderAutolink
	| RenderImage
	| RenderBreak
	| RenderRawInline;

export interface RenderParagraph {
	readonly type: "paragraph";
	readonly children: RenderInline[];
}

export interface RenderHeading {
	readonly type: "heading";
	readonly level: 1 | 2 | 3 | 4 | 5 | 6;
	readonly children: RenderInline[];
}

export interface RenderBlockquote {
	readonly type: "blockquote";
	readonly blocks: RenderBlock[];
}

export interface RenderList {
	readonly type: "list";
	readonly ordered: boolean;
	readonly start?: number;
	readonly spread?: boolean;
	readonly items: RenderListItem[];
}

export interface RenderListItem {
	readonly blocks: RenderBlock[];
	readonly checked?: boolean;
	readonly spread?: boolean;
}

export interface RenderCodeBlock {
	readonly type: "code";
	readonly value: string;
	readonly lang?: string;
	readonly meta?: string;
}

export interface RenderThematicBreak {
	readonly type: "thematicBreak";
}

export interface RenderTable {
	readonly type: "table";
	readonly align?: Array<"left" | "center" | "right">;
	readonly headers: RenderInline[][];
	readonly rows: RenderInline[][][];
}

export interface RenderRawBlock {
	readonly type: "raw";
	readonly value: string;
}

export interface RenderText {
	readonly type: "text";
	readonly value: string;
}

export interface RenderEmphasis {
	readonly type: "emphasis";
	readonly children: RenderInline[];
}

export interface RenderStrong {
	readonly type: "strong";
	readonly children: RenderInline[];
}

export interface RenderStrikethrough {
	readonly type: "strikethrough";
	readonly children: RenderInline[];
}

export interface RenderInlineCode {
	readonly type: "inlineCode";
	readonly value: string;
}

export interface RenderLink {
	readonly type: "link";
	readonly url: string;
	readonly children: RenderInline[];
}

export interface RenderAutolink {
	readonly type: "autolink";
	readonly url: string;
}

export interface RenderImage {
	readonly type: "image";
	readonly alt: string;
	readonly url: string;
}

export interface RenderBreak {
	readonly type: "break";
}

export interface RenderRawInline {
	readonly type: "raw";
	readonly value: string;
}

/**
 * Options for {@link renderDocument}.
 */
export interface RenderDocumentOptions {
	/**
	 * A fully resolved document theme.
	 */
	readonly theme?: MarkdownTheme;

	/**
	 * Style configuration used to build a theme when {@link theme} is omitted.
	 */
	readonly style?: CreateMarkdownThemeOptions["style"];

	/**
	 * Maximum terminal width in columns.
	 */
	readonly width?: number;

	/**
	 * Left indentation applied to the rendered output.
	 *
	 * @default 0
	 */
	readonly indent?: number;
}

/**
 * Options for {@link renderMarkdown}.
 */
export interface RenderMarkdownOptions extends RenderDocumentOptions {
	/**
	 * Preserve a trailing newline when the input markdown ends with one.
	 *
	 * @default false
	 */
	readonly preserveTrailingNewline?: boolean;
}

/**
 * Minimal write target used by the streaming renderer.
 */
export interface RenderWriteTarget {
	readonly isTTY?: boolean;
	readonly columns?: number;
	write(chunk: string): unknown;
}

/**
 * Options for {@link createDocumentStreamRenderer}.
 */
export interface DocumentStreamRendererOptions extends RenderDocumentOptions {
	/**
	 * The output stream used for transient frame updates.
	 *
	 * @default process.stderr
	 */
	readonly output?: RenderWriteTarget;

	/**
	 * Whether incremental updates should be painted as transient terminal frames.
	 *
	 * When `false`, the controller still tracks state but does not write frames.
	 *
	 * @default true
	 */
	readonly transient?: boolean;
}

/**
 * Options for {@link createMarkdownStreamRenderer}.
 */
export interface MarkdownStreamRendererOptions
	extends DocumentStreamRendererOptions {
	readonly preserveTrailingNewline?: boolean;
}

/**
 * Stateful streaming renderer for generic render documents.
 */
export interface DocumentStreamRenderer {
	/**
	 * Replace the current document and re-render.
	 *
	 * @returns The latest rendered snapshot.
	 */
	replace(document: RenderDocument): string;

	/**
	 * Return the current rendered snapshot without mutating the buffer.
	 */
	snapshot(): string;

	/**
	 * Clear the transient frame from the terminal, if one is currently painted.
	 */
	clear(): void;

	/**
	 * Finish the stream and optionally persist the latest rendered snapshot.
	 *
	 * @returns The latest rendered snapshot.
	 */
	close(options?: {
		readonly persist?: boolean;
		readonly output?: RenderWriteTarget;
	}): string;
}

/**
 * Stateful streaming renderer that buffers markdown and reuses the shared
 * document serializer.
 */
export interface MarkdownStreamRenderer {
	/**
	 * Append a chunk to the buffered markdown and re-render.
	 *
	 * @returns The latest rendered snapshot.
	 */
	append(chunk: string): string;

	/**
	 * Replace the entire buffered markdown and re-render.
	 *
	 * @returns The latest rendered snapshot.
	 */
	replace(markdown: string): string;

	/**
	 * Return the current rendered snapshot without mutating the buffer.
	 */
	snapshot(): string;

	/**
	 * Clear the transient frame from the terminal, if one is currently painted.
	 */
	clear(): void;

	/**
	 * Finish the stream and optionally persist the latest rendered snapshot.
	 *
	 * @returns The latest rendered snapshot.
	 */
	close(options?: {
		readonly persist?: boolean;
		readonly output?: RenderWriteTarget;
	}): string;
}
