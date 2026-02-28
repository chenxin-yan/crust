// ────────────────────────────────────────────────────────────────────────────
// renderMarkdownTypingStream — Terminal patch stream for typing visuals
// ────────────────────────────────────────────────────────────────────────────

import type { RenderOptions } from "./types.ts";
import {
	applyTypingFrame,
	createTypingMarkdownRenderer,
	type TypingPatchState,
} from "./typing.ts";

export interface TypingStreamOptions extends RenderOptions {
	readonly terminalPatches?: boolean;
}

export async function* renderMarkdownTypingStream(
	source: AsyncIterable<string>,
	options?: TypingStreamOptions,
): AsyncIterable<string> {
	const renderer = createTypingMarkdownRenderer(options);
	const usePatches = options?.terminalPatches ?? true;
	let patchState: TypingPatchState = {
		previewRows: 0,
		previewStartsWithNewline: false,
	};
	const width = options?.width ?? 80;

	for await (const chunk of source) {
		const frame = renderer.write(chunk);

		if (usePatches) {
			const patched = applyTypingFrame(frame, patchState, width);
			patchState = patched.state;
			if (patched.delta) {
				yield patched.delta;
			}
		} else if (frame.append) {
			yield frame.append;
		}
	}

	const finalFrame = renderer.end();
	if (usePatches) {
		const patched = applyTypingFrame(finalFrame, patchState, width);
		if (patched.delta) {
			yield patched.delta;
		}
	} else if (finalFrame.append) {
		yield finalFrame.append;
	}
}
