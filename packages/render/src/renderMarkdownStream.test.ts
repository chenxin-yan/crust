import { describe, expect, it } from "bun:test";
import { renderMarkdown } from "./renderMarkdown.ts";
import { renderMarkdownStream } from "./renderMarkdownStream.ts";
import type { RenderOptions } from "./types.ts";

/** Helper: create an async iterable from an array of strings. */
async function* asyncChunks(chunks: string[]): AsyncIterable<string> {
	for (const chunk of chunks) {
		yield chunk;
	}
}

/** Helper: collect all yielded values from an async iterable into a string. */
async function collect(source: AsyncIterable<string>): Promise<string> {
	let result = "";
	for await (const delta of source) {
		result += delta;
	}
	return result;
}

const opts: RenderOptions = {
	width: 80,
	style: { mode: "never" },
};

describe("renderMarkdownStream", () => {
	it("produces output matching renderMarkdown when fed full document in chunks", async () => {
		const markdown = [
			"# Hello World\n\n",
			"This is a **bold** paragraph with `inline code`.\n\n",
			"- item 1\n",
			"- item 2\n",
			"- item 3\n\n",
			"```js\nconsole.log('hi');\n```\n\n",
			"> A blockquote\n\n",
			"| A | B |\n| --- | --- |\n| 1 | 2 |\n",
		];
		const fullInput = markdown.join("");

		const streamOutput = await collect(
			renderMarkdownStream(asyncChunks(markdown), opts),
		);
		const oneShotOutput = renderMarkdown(fullInput, opts);

		expect(streamOutput).toBe(oneShotOutput);
	});

	it("produces empty output for empty source", async () => {
		const output = await collect(renderMarkdownStream(asyncChunks([]), opts));
		expect(output).toBe("");
	});

	it("single-chunk source matches one-shot rendering", async () => {
		const markdown =
			"# Title\n\nA paragraph with *emphasis* and [a link](https://example.com).\n";

		const streamOutput = await collect(
			renderMarkdownStream(asyncChunks([markdown]), opts),
		);
		const oneShotOutput = renderMarkdown(markdown, opts);

		expect(streamOutput).toBe(oneShotOutput);
	});

	it("source with empty strings between real chunks produces correct output", async () => {
		const markdown = "# Hello\n\nWorld\n";
		const chunks = ["", "# ", "", "Hello", "", "\n\n", "", "World\n", ""];

		const streamOutput = await collect(
			renderMarkdownStream(asyncChunks(chunks), opts),
		);
		const oneShotOutput = renderMarkdown(markdown, opts);

		expect(streamOutput).toBe(oneShotOutput);
	});

	it("yields non-empty deltas only", async () => {
		const chunks = ["# Hello\n\n", "Paragraph\n\n", "More text\n"];
		const deltas: string[] = [];

		for await (const delta of renderMarkdownStream(asyncChunks(chunks), opts)) {
			deltas.push(delta);
		}

		// Every yielded delta should be non-empty
		for (const delta of deltas) {
			expect(delta.length).toBeGreaterThan(0);
		}

		// Concatenated deltas should match one-shot output
		const streamOutput = deltas.join("");
		const oneShotOutput = renderMarkdown(chunks.join(""), opts);
		expect(streamOutput).toBe(oneShotOutput);
	});

	it("handles character-by-character streaming", async () => {
		const markdown = "**bold** and *italic*\n";
		const chars = markdown.split("");

		const streamOutput = await collect(
			renderMarkdownStream(asyncChunks(chars), opts),
		);
		const oneShotOutput = renderMarkdown(markdown, opts);

		expect(streamOutput).toBe(oneShotOutput);
	});

	it("respects width option", async () => {
		const markdown =
			"# Heading\n\nA very long paragraph that should be wrapped at a narrow width to verify that width options are passed through correctly.\n";
		const narrowOpts: RenderOptions = { width: 30, style: { mode: "never" } };

		const streamOutput = await collect(
			renderMarkdownStream(asyncChunks([markdown]), narrowOpts),
		);
		const oneShotOutput = renderMarkdown(markdown, narrowOpts);

		expect(streamOutput).toBe(oneShotOutput);
	});

	it("works with line-by-line streaming", async () => {
		const lines = [
			"# Heading\n",
			"\n",
			"Paragraph one.\n",
			"\n",
			"Paragraph two.\n",
		];

		const streamOutput = await collect(
			renderMarkdownStream(asyncChunks(lines), opts),
		);
		const oneShotOutput = renderMarkdown(lines.join(""), opts);

		expect(streamOutput).toBe(oneShotOutput);
	});
});
