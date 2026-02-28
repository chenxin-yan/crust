import { describe, expect, it } from "bun:test";
import { renderMarkdown } from "./renderMarkdown.ts";
import { renderMarkdownTypingStream } from "./renderMarkdownTypingStream.ts";

async function* asyncChunks(chunks: string[]): AsyncIterable<string> {
	for (const chunk of chunks) {
		yield chunk;
	}
}

async function collect(source: AsyncIterable<string>): Promise<string> {
	let result = "";
	for await (const value of source) {
		result += value;
	}
	return result;
}

describe("renderMarkdownTypingStream", () => {
	it("matches one-shot output when terminalPatches=false", async () => {
		const chunks = ["# Title\n\n", "**bo", "ld** text\n", "\n- a\n- b\n"];
		const markdown = chunks.join("");

		const output = await collect(
			renderMarkdownTypingStream(asyncChunks(chunks), {
				style: { mode: "never" },
				terminalPatches: false,
			}),
		);

		expect(output).toBe(renderMarkdown(markdown, { style: { mode: "never" } }));
	});

	it("emits ansi cursor patch codes when terminalPatches=true", async () => {
		const output = await collect(
			renderMarkdownTypingStream(asyncChunks(["**abc", " def**"]), {
				style: { mode: "never" },
				terminalPatches: true,
			}),
		);

		expect(output.includes("\u001b[")).toBe(true);
	});
});
