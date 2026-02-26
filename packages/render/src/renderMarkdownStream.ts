// ────────────────────────────────────────────────────────────────────────────
// renderMarkdownStream — Async iterable wrapper for streaming markdown rendering
// ────────────────────────────────────────────────────────────────────────────

import { createMarkdownRenderer } from "./streaming.ts";
import type { RenderOptions } from "./types.ts";

/**
 * Render a streaming markdown source into styled terminal output,
 * yielding incremental deltas as an async iterable.
 *
 * This is a convenience wrapper around {@link createMarkdownRenderer}
 * that consumes an `AsyncIterable<string>` source (e.g., an LLM token
 * stream, chunked HTTP response, or async generator) and yields
 * rendered terminal output as each stable block is flushed.
 *
 * The **determinism invariant** holds: joining all yielded strings
 * produces output identical to `renderMarkdown(fullInput, options)`.
 *
 * @param source - Async iterable of markdown text chunks.
 * @param options - Rendering options (width, theme, style).
 * @returns An async iterable of rendered terminal output deltas.
 *
 * @example
 * ```ts
 * import { renderMarkdownStream } from "@crustjs/render";
 *
 * for await (const delta of renderMarkdownStream(llmStream, { width: 80 })) {
 *   process.stdout.write(delta);
 * }
 * ```
 */
export async function* renderMarkdownStream(
	source: AsyncIterable<string>,
	options?: RenderOptions,
): AsyncIterable<string> {
	const renderer = createMarkdownRenderer(options);

	for await (const chunk of source) {
		const delta = renderer.write(chunk);
		if (delta) {
			yield delta;
		}
	}

	const remaining = renderer.end();
	if (remaining) {
		yield remaining;
	}
}
