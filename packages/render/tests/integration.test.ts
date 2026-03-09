import { describe, expect, it } from "bun:test";
import { renderMarkdown } from "../src/render.ts";

describe("@crustjs/render integration", () => {
	it("renders a representative markdown document for plain terminals", () => {
		const markdown = [
			"# Release Notes",
			"",
			"Visit <https://crustjs.com> for more details.",
			"",
			"1. ship render module",
			"2. add docs",
			"",
			"![diagram](https://example.com/diagram.png)",
		].join("\n");

		expect(
			renderMarkdown(markdown, {
				style: { mode: "never" },
				width: 80,
			}),
		).toBe(
			[
				"# Release Notes",
				"",
				"Visit <https://crustjs.com> for more details.",
				"",
				"1. ship render module",
				"2. add docs",
				"",
				"[image: diagram] (https://example.com/diagram.png)",
			].join("\n"),
		);
	});
});
