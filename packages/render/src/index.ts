// ────────────────────────────────────────────────────────────────────────────
// @crustjs/render — Streaming-first markdown rendering engine for the terminal
// ────────────────────────────────────────────────────────────────────────────

// One-shot rendering
export { renderMarkdown } from "./renderMarkdown.ts";
export { renderMarkdownStream } from "./renderMarkdownStream.ts";
export {
	renderMarkdownTypingStream,
	type TypingStreamOptions,
} from "./renderMarkdownTypingStream.ts";
// Streaming rendering
export type { MarkdownRenderer } from "./streaming.ts";
export { createMarkdownRenderer } from "./streaming.ts";
// Markdown theme
export type { CreateMarkdownThemeOptions } from "./theme/createMarkdownTheme.ts";
export {
	createMarkdownTheme,
	defaultTheme,
} from "./theme/createMarkdownTheme.ts";
export type {
	MarkdownTheme,
	PartialMarkdownTheme,
	ThemeSlotFn,
} from "./theme/markdownTheme.ts";
export { buildDefaultMarkdownTheme } from "./theme/markdownTheme.ts";
// Render options
export type { RenderOptions } from "./types.ts";
export {
	applyTypingFrame,
	createTypingMarkdownRenderer,
	type TypingFrame,
	type TypingMarkdownRenderer,
	type TypingPatchState,
} from "./typing.ts";
