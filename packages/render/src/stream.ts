// ────────────────────────────────────────────────────────────────────────────
// Stream — Shared streaming renderers for documents and markdown
// ────────────────────────────────────────────────────────────────────────────

import { visibleWidth } from "@crustjs/style";
import { markdownToDocument } from "./markdown.ts";
import { renderDocument } from "./render.ts";
import type {
	DocumentStreamRenderer,
	DocumentStreamRendererOptions,
	MarkdownStreamRenderer,
	MarkdownStreamRendererOptions,
	RenderDocument,
	RenderWriteTarget,
} from "./types.ts";

const ESC = "\x1B[";
const ERASE_LINE = `${ESC}2K`;

function cursorUp(lines: number): string {
	return lines > 0 ? `${ESC}${lines}A` : "";
}

function physicalLineCount(content: string, columns: number): number {
	const logicalLines = content.split("\n");
	let count = 0;
	for (const line of logicalLines) {
		const width = visibleWidth(line);
		count += width === 0 ? 1 : Math.ceil(width / columns);
	}
	return count;
}

function erasePreviousFrame(
	output: RenderWriteTarget,
	lineCount: number,
): void {
	if (lineCount <= 0) {
		return;
	}

	output.write(`${cursorUp(lineCount - 1)}\r`);
	for (let index = 0; index < lineCount; index++) {
		output.write(ERASE_LINE);
		if (index < lineCount - 1) {
			output.write(`${ESC}1B`);
		}
	}
	if (lineCount > 1) {
		output.write(cursorUp(lineCount - 1));
	}
	output.write("\r");
}

/**
 * Create a streaming renderer for generic render documents.
 */
export function createDocumentStreamRenderer(
	options?: DocumentStreamRendererOptions,
): DocumentStreamRenderer {
	const transient = options?.transient ?? true;
	const output = options?.output ?? process.stderr;

	let document: RenderDocument = { blocks: [] };
	let latestRendered = "";
	let paintedLineCount = 0;

	function resolveRender(): string {
		return renderDocument(document, {
			...options,
			width: options?.width ?? output.columns,
		});
	}

	function canPaint(target: RenderWriteTarget): boolean {
		return transient && !!target.isTTY;
	}

	function paint(rendered: string): void {
		if (!canPaint(output)) {
			latestRendered = rendered;
			return;
		}

		erasePreviousFrame(output, paintedLineCount);
		if (rendered.length > 0) {
			output.write(rendered);
			paintedLineCount = physicalLineCount(rendered, output.columns || 80);
		} else {
			paintedLineCount = 0;
		}

		latestRendered = rendered;
	}

	return {
		replace(nextDocument: RenderDocument): string {
			document = nextDocument;
			const rendered = resolveRender();
			paint(rendered);
			return rendered;
		},

		snapshot(): string {
			if (latestRendered.length === 0 && document.blocks.length > 0) {
				latestRendered = resolveRender();
			}
			return latestRendered;
		},

		clear(): void {
			if (!canPaint(output)) {
				latestRendered = "";
				return;
			}

			erasePreviousFrame(output, paintedLineCount);
			paintedLineCount = 0;
			latestRendered = "";
		},

		close(closeOptions): string {
			const rendered =
				latestRendered.length > 0 ? latestRendered : resolveRender();

			if (canPaint(output)) {
				erasePreviousFrame(output, paintedLineCount);
				paintedLineCount = 0;
			}

			if (closeOptions?.persist) {
				const persistOutput = closeOptions.output ?? process.stdout;
				if (rendered.length > 0) {
					persistOutput.write(rendered);
				}
			}

			latestRendered = rendered;
			return rendered;
		},
	};
}

/**
 * Create a markdown streaming renderer that compiles markdown into the shared
 * document IR before delegating to the generic document streamer.
 */
export function createMarkdownStreamRenderer(
	options?: MarkdownStreamRendererOptions,
): MarkdownStreamRenderer {
	const documentRenderer = createDocumentStreamRenderer(options);
	let markdown = "";

	function renderCurrentMarkdown(): string {
		return documentRenderer.replace(markdownToDocument(markdown));
	}

	return {
		append(chunk: string): string {
			markdown += chunk;
			return renderCurrentMarkdown();
		},

		replace(nextMarkdown: string): string {
			markdown = nextMarkdown;
			return renderCurrentMarkdown();
		},

		snapshot(): string {
			return documentRenderer.snapshot();
		},

		clear(): void {
			documentRenderer.clear();
		},

		close(options): string {
			return documentRenderer.close(options);
		},
	};
}
