// ────────────────────────────────────────────────────────────────────────────
// @crustjs/render — Terminal rendering primitives and markdown adapters
// ────────────────────────────────────────────────────────────────────────────

export { markdownToDocument, rootToDocument } from "./markdown.ts";
export { parseMarkdown } from "./parse.ts";
export { renderDocument, renderMarkdown } from "./render.ts";
export {
	createDocumentStreamRenderer,
	createMarkdownStreamRenderer,
} from "./stream.ts";
export type {
	DocumentStreamRenderer,
	DocumentStreamRendererOptions,
	MarkdownStreamRenderer,
	MarkdownStreamRendererOptions,
	RenderBlock,
	RenderDocument,
	RenderDocumentOptions,
	RenderInline,
	RenderListItem,
	RenderMarkdownOptions,
	RenderWriteTarget,
} from "./types.ts";
