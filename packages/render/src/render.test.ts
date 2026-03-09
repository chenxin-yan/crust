import { describe, expect, it } from "bun:test";
import { visibleWidth } from "@crustjs/style";
import { renderDocument, renderMarkdown } from "./render.ts";
import {
	createDocumentStreamRenderer,
	createMarkdownStreamRenderer,
} from "./stream.ts";

describe("renderMarkdown", () => {
	it("renders headings, inline styles, and links without ANSI when disabled", () => {
		const output = renderMarkdown(
			"# Title\n\nHello *there* and **friend** with `code` and [docs](https://example.com).",
			{
				style: { mode: "never" },
			},
		);

		expect(output).toBe(
			"# Title\n\nHello _there_ and **friend** with `code` and docs (https://example.com).",
		);
	});

	it("wraps paragraphs to the configured width", () => {
		const output = renderMarkdown(
			"this paragraph should wrap cleanly across several terminal lines",
			{
				style: { mode: "never" },
				width: 18,
			},
		);

		for (const line of output.split("\n")) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(18);
		}
	});

	it("renders lists, task items, blockquotes, and code fences", () => {
		const output = renderMarkdown(
			"> quoted\n\n- first item\n- second item\n- [x] done\n\n```ts\nconst value = 1;\n```",
			{
				style: { mode: "never" },
			},
		);

		expect(output).toBe(
			"> quoted\n\n- first item\n- second item\n[x] done\n\n``` ts\nconst value = 1;\n```",
		);
	});

	it("renders gfm tables with aligned borders", () => {
		const output = renderMarkdown(
			"| Name | Score |\n| :--- | ---: |\n| Ada | 42 |\n| Lin | 7 |",
			{
				style: { mode: "never" },
			},
		);

		expect(output).toBe(
			"| Name | Score |\n|------|-------|\n| Ada  |    42 |\n| Lin  |     7 |",
		);
	});

	it("preserves a trailing newline when requested", () => {
		const output = renderMarkdown("## Title\n", {
			style: { mode: "never" },
			preserveTrailingNewline: true,
		});

		expect(output.endsWith("\n")).toBe(true);
	});
});

describe("renderDocument", () => {
	it("renders the shared document ir directly", () => {
		const output = renderDocument(
			{
				blocks: [
					{
						type: "heading",
						level: 1,
						children: [{ type: "text", value: "Title" }],
					},
					{
						type: "paragraph",
						children: [
							{ type: "text", value: "Visit " },
							{ type: "autolink", url: "https://crustjs.com" },
						],
					},
				],
			},
			{
				style: { mode: "never" },
			},
		);

		expect(output).toBe("# Title\n\nVisit <https://crustjs.com>");
	});
});

describe("createDocumentStreamRenderer", () => {
	it("renders generic documents through the shared stream layer", () => {
		let outputBuffer = "";
		const output = {
			isTTY: true,
			columns: 40,
			write(chunk: string) {
				outputBuffer += chunk;
				return true;
			},
		};

		const renderer = createDocumentStreamRenderer({
			style: { mode: "never" },
			output,
		});

		const first = renderer.replace({
			blocks: [
				{
					type: "paragraph",
					children: [{ type: "text", value: "hello" }],
				},
			],
		});
		const final = renderer.close({ persist: true, output });

		expect(first).toBe("hello");
		expect(final).toBe("hello");
		expect(outputBuffer).toContain("\x1B[2K");
	});
});

describe("createMarkdownStreamRenderer", () => {
	it("re-renders buffered markdown and paints transient frames", () => {
		let outputBuffer = "";
		const output = {
			isTTY: true,
			columns: 40,
			write(chunk: string) {
				outputBuffer += chunk;
				return true;
			},
		};

		const renderer = createMarkdownStreamRenderer({
			style: { mode: "never" },
			output,
		});

		const first = renderer.append("# Hello");
		const second = renderer.append("\n\nworld");
		const final = renderer.close({ persist: true, output });

		expect(first).toBe("# Hello");
		expect(second).toBe("# Hello\n\nworld");
		expect(final).toBe("# Hello\n\nworld");
		expect(outputBuffer).toContain("\x1B[2K");
		expect(outputBuffer).toContain("# Hello\n\nworld");
	});
});
