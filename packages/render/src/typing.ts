// ────────────────────────────────────────────────────────────────────────────
// Typing renderer — Mutable tail preview for LLM-style terminal streaming
// ────────────────────────────────────────────────────────────────────────────

import { visibleWidth } from "@crustjs/style";
import type { RootContent } from "mdast";
import { parseMd } from "./parse.ts";
import { renderBlocks } from "./render.ts";
import { resolveContext } from "./renderMarkdown.ts";
import type { RenderContext, RenderOptions } from "./types.ts";

export interface TypingFrame {
	readonly append: string;
	readonly preview: string;
	readonly done: boolean;
}

export interface TypingPatchState {
	readonly previewRows: number;
	readonly previewStartsWithNewline: boolean;
}

export interface TypingMarkdownRenderer {
	write(chunk: string): TypingFrame;
	end(): TypingFrame;
	reset(): void;
}

function serializeNode(node: RootContent): string {
	return JSON.stringify(node, (key, value: unknown) => {
		if (key === "position") return undefined;
		return value;
	});
}

function countTerminalRows(text: string, width: number): number {
	if (!text) return 0;

	const safeWidth = Math.max(1, width);
	const lines = text.split("\n");
	let rows = 0;

	for (const line of lines) {
		const cols = visibleWidth(line);
		rows += Math.max(1, Math.ceil(cols / safeWidth));
	}

	if (text.startsWith("\n")) {
		rows = Math.max(0, rows - 1);
	}

	return rows;
}

function clearPreviousPreview(
	previewRows: number,
	previewStartsWithNewline: boolean,
): string {
	if (previewRows <= 0) return "";

	let ansi = "\r";
	for (let i = 0; i < previewRows; i++) {
		ansi += "\u001b[2K";
		if (i < previewRows - 1) {
			ansi += "\u001b[1A\r";
		}
	}

	if (previewStartsWithNewline) {
		ansi += "\u001b[1A\r";
	}

	return ansi;
}

function renderSlice(
	nodes: RootContent[],
	ctx: RenderContext,
	needsLeadingSeparator: boolean,
): string {
	if (nodes.length === 0) return "";
	const rendered = renderBlocks(nodes, ctx);
	if (!rendered) return "";
	return needsLeadingSeparator ? `\n\n${rendered}` : rendered;
}

export function applyTypingFrame(
	frame: TypingFrame,
	state: TypingPatchState,
	width = 80,
): { delta: string; state: TypingPatchState } {
	const clear = clearPreviousPreview(
		state.previewRows,
		state.previewStartsWithNewline,
	);
	const delta = `${clear}${frame.append}${frame.preview}`;

	return {
		delta,
		state: {
			previewRows: countTerminalRows(frame.preview, width),
			previewStartsWithNewline: frame.preview.startsWith("\n"),
		},
	};
}

export function createTypingMarkdownRenderer(
	options?: RenderOptions,
): TypingMarkdownRenderer {
	const ctx = resolveContext(options);

	let buffer = "";
	let committedCount = 0;
	let hasCommittedOutput = false;
	let previousBlocks: string[] = [];
	let currentPreview = "";

	return {
		write(chunk: string): TypingFrame {
			if (!chunk) {
				return { append: "", preview: currentPreview, done: false };
			}

			buffer += chunk;

			const tree = parseMd(buffer);
			const currentChildren = tree.children;
			const currentBlocks = currentChildren.map(serializeNode);

			let newStableCount = committedCount;
			const stableLimit = Math.max(0, currentBlocks.length - 1);

			for (let i = committedCount; i < stableLimit; i++) {
				if (
					i < previousBlocks.length &&
					currentBlocks[i] === previousBlocks[i]
				) {
					newStableCount = i + 1;
				} else {
					break;
				}
			}

			let append = "";
			if (newStableCount > committedCount) {
				append = renderSlice(
					currentChildren.slice(committedCount, newStableCount),
					ctx,
					hasCommittedOutput,
				);
				if (append) {
					hasCommittedOutput = true;
				}
				committedCount = newStableCount;
			}

			currentPreview = renderSlice(
				currentChildren.slice(committedCount),
				ctx,
				hasCommittedOutput,
			);
			previousBlocks = currentBlocks;

			return { append, preview: currentPreview, done: false };
		},

		end(): TypingFrame {
			if (!buffer) {
				currentPreview = "";
				return { append: "", preview: "", done: true };
			}

			const tree = parseMd(buffer);
			const append = renderSlice(
				tree.children.slice(committedCount),
				ctx,
				hasCommittedOutput,
			);

			committedCount = tree.children.length;
			if (append) {
				hasCommittedOutput = true;
			}
			currentPreview = "";
			previousBlocks = [];

			return { append, preview: "", done: true };
		},

		reset(): void {
			buffer = "";
			committedCount = 0;
			hasCommittedOutput = false;
			previousBlocks = [];
			currentPreview = "";
		},
	};
}
