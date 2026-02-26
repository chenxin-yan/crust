// ────────────────────────────────────────────────────────────────────────────
// Streaming Renderer — stable-block flushing strategy
// ────────────────────────────────────────────────────────────────────────────

import type { RootContent } from "mdast";
import { parseMd } from "./parse.ts";
import { renderBlocks } from "./render.ts";
import { resolveContext } from "./renderMarkdown.ts";
import type { RenderContext, RenderOptions } from "./types.ts";

/**
 * The streaming markdown renderer returned by {@link createMarkdownRenderer}.
 *
 * Accumulates markdown chunks and flushes stable blocks as append-only
 * terminal output. Flushed content is never invalidated.
 */
export interface MarkdownRenderer {
	/**
	 * Append a markdown chunk to the internal buffer.
	 *
	 * Parses the accumulated buffer, detects structurally stable blocks
	 * (blocks whose content will not change with future input), and
	 * returns the rendered output for any newly-stable blocks.
	 *
	 * @param chunk - Markdown text to append.
	 * @returns Rendered terminal output for newly-flushed blocks,
	 *   or an empty string if nothing new was flushed.
	 */
	write(chunk: string): string;

	/**
	 * Signal end of input and flush all remaining content.
	 *
	 * Renders any unflushed blocks (including the in-progress tail)
	 * and returns the final output. After calling `end()`, the renderer
	 * should be `reset()` before reuse.
	 *
	 * @returns Rendered terminal output for all remaining blocks.
	 */
	end(): string;

	/**
	 * Reset the renderer to its initial state.
	 *
	 * Clears the internal buffer, flushed block count, and parse state.
	 * The renderer can be reused after calling `reset()`.
	 */
	reset(): void;
}

/**
 * Serialize an mdast node to a stable JSON string for comparison.
 *
 * Strips `position` metadata since it changes as the buffer grows,
 * but structural changes (type, value, children) must be detected.
 */
function serializeNode(node: RootContent): string {
	return JSON.stringify(node, (key, value: unknown) => {
		if (key === "position") return undefined;
		return value;
	});
}

/**
 * Create a streaming markdown renderer with stable-block flushing.
 *
 * The renderer accumulates incoming markdown chunks in a rolling buffer.
 * On each {@link MarkdownRenderer.write | write()}, the buffer is parsed
 * into an mdast tree. Blocks that are structurally complete (identical
 * across consecutive parses) are rendered and flushed as append-only
 * output. Only the unfinished tail is kept mutable.
 *
 * The **determinism invariant** holds: concatenating all `write()` return
 * values plus the `end()` return value produces output identical to
 * `renderMarkdown(fullInput, options)`.
 *
 * @param options - Rendering options (width, theme, style).
 * @returns A {@link MarkdownRenderer} with `write`, `end`, and `reset` methods.
 *
 * @example
 * ```ts
 * import { createMarkdownRenderer } from "@crustjs/render";
 *
 * const renderer = createMarkdownRenderer({ width: 80 });
 *
 * for await (const chunk of llmStream) {
 *   const delta = renderer.write(chunk);
 *   process.stdout.write(delta);
 * }
 * const remaining = renderer.end();
 * process.stdout.write(remaining);
 * ```
 */
export function createMarkdownRenderer(
	options?: RenderOptions,
): MarkdownRenderer {
	const ctx: RenderContext = resolveContext(options);

	/** Rolling buffer of accumulated markdown input. */
	let buffer = "";

	/** Number of blocks already flushed (rendered and emitted). */
	let flushedCount = 0;

	/** Whether any non-empty block has been flushed yet. */
	let hasFlushedOutput = false;

	/**
	 * Serialized representations of blocks from the previous parse.
	 * Used for stability detection — a block is stable when its
	 * serialized form matches across consecutive parses.
	 */
	let previousBlocks: string[] = [];

	/**
	 * Render a slice of blocks and return the output string.
	 * Handles the `\n\n` separator between the previously flushed
	 * content and the new blocks.
	 */
	function renderSlice(
		nodes: RootContent[],
		needsLeadingSeparator: boolean,
	): string {
		if (nodes.length === 0) return "";

		const rendered = renderBlocks(nodes, ctx);
		if (rendered === "") return "";

		if (needsLeadingSeparator) {
			return `\n\n${rendered}`;
		}
		return rendered;
	}

	return {
		write(chunk: string): string {
			if (!chunk) return "";

			buffer += chunk;

			// Parse the full accumulated buffer
			const tree = parseMd(buffer);
			const currentChildren = tree.children;
			const currentBlocks = currentChildren.map(serializeNode);

			// Find newly stable blocks.
			// A block is stable when:
			// 1. It existed in the previous parse at the same position
			// 2. Its serialized content is identical across both parses
			// 3. It is NOT the last block (the tail is always mutable)
			//
			// We only check blocks beyond what we've already flushed.
			let newStableCount = flushedCount;

			// The last block is never considered stable during write()
			const stableLimit = Math.max(0, currentBlocks.length - 1);

			for (let i = flushedCount; i < stableLimit; i++) {
				if (
					i < previousBlocks.length &&
					currentBlocks[i] === previousBlocks[i]
				) {
					newStableCount = i + 1;
				} else {
					// Once we hit a non-matching block, stop — blocks after it
					// could have been affected by the change
					break;
				}
			}

			previousBlocks = currentBlocks;

			// Flush newly stable blocks
			if (newStableCount > flushedCount) {
				const newBlocks = currentChildren.slice(flushedCount, newStableCount);
				const needsSeparator = hasFlushedOutput;
				const output = renderSlice(newBlocks, needsSeparator);

				if (output !== "") {
					hasFlushedOutput = true;
				}

				flushedCount = newStableCount;
				return output;
			}

			return "";
		},

		end(): string {
			// Flush all remaining unflushed blocks
			if (!buffer) return "";

			const tree = parseMd(buffer);
			const remaining = tree.children.slice(flushedCount);

			if (remaining.length === 0) return "";

			const needsSeparator = hasFlushedOutput;
			const output = renderSlice(remaining, needsSeparator);

			// Mark everything as flushed
			flushedCount = tree.children.length;
			if (output !== "") {
				hasFlushedOutput = true;
			}

			return output;
		},

		reset(): void {
			buffer = "";
			flushedCount = 0;
			hasFlushedOutput = false;
			previousBlocks = [];
		},
	};
}
