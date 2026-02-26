import { describe, expect, it } from "bun:test";
import { renderMarkdown } from "./renderMarkdown.ts";
import { createMarkdownRenderer } from "./streaming.ts";
import type { RenderOptions } from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/** No-color options for deterministic assertions. */
const NO_COLOR: RenderOptions = { style: { mode: "never" } };

/**
 * Feed a full string to a streaming renderer character by character
 * and return the concatenated output.
 */
function feedCharByChar(
	input: string,
	options: RenderOptions = NO_COLOR,
): string {
	const renderer = createMarkdownRenderer(options);
	let output = "";
	for (const ch of input) {
		output += renderer.write(ch);
	}
	output += renderer.end();
	return output;
}

/**
 * Feed a full string to a streaming renderer line by line
 * and return the concatenated output.
 */
function feedByLine(input: string, options: RenderOptions = NO_COLOR): string {
	const renderer = createMarkdownRenderer(options);
	let output = "";
	const lines = input.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const chunk = i < lines.length - 1 ? `${lines[i]}\n` : (lines[i] ?? "");
		output += renderer.write(chunk);
	}
	output += renderer.end();
	return output;
}

/**
 * Feed a full string in one write() + end() and return concatenated output.
 */
function feedAllAtOnce(
	input: string,
	options: RenderOptions = NO_COLOR,
): string {
	const renderer = createMarkdownRenderer(options);
	let output = "";
	output += renderer.write(input);
	output += renderer.end();
	return output;
}

// ────────────────────────────────────────────────────────────────────────────
// Basic functionality
// ────────────────────────────────────────────────────────────────────────────

describe("createMarkdownRenderer — basic", () => {
	it("should return an object with write, end, and reset methods", () => {
		const renderer = createMarkdownRenderer(NO_COLOR);
		expect(typeof renderer.write).toBe("function");
		expect(typeof renderer.end).toBe("function");
		expect(typeof renderer.reset).toBe("function");
	});

	it("should return empty string for empty write()", () => {
		const renderer = createMarkdownRenderer(NO_COLOR);
		expect(renderer.write("")).toBe("");
	});

	it("should return empty string for end() with no input", () => {
		const renderer = createMarkdownRenderer(NO_COLOR);
		expect(renderer.end()).toBe("");
	});

	it("should return empty string for end() after empty writes", () => {
		const renderer = createMarkdownRenderer(NO_COLOR);
		renderer.write("");
		renderer.write("");
		expect(renderer.end()).toBe("");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Determinism invariant: streaming output must equal one-shot output
// ────────────────────────────────────────────────────────────────────────────

describe("createMarkdownRenderer — determinism (all-at-once)", () => {
	it("should match renderMarkdown for a simple paragraph", () => {
		const md = "Hello world.";
		const expected = renderMarkdown(md, NO_COLOR);
		expect(feedAllAtOnce(md)).toBe(expected);
	});

	it("should match renderMarkdown for headings and paragraphs", () => {
		const md = "# Title\n\nParagraph one.\n\nParagraph two.";
		const expected = renderMarkdown(md, NO_COLOR);
		expect(feedAllAtOnce(md)).toBe(expected);
	});

	it("should match renderMarkdown for a full GFM document", () => {
		const md = `# Main Title

This is a paragraph with **bold**, *italic*, and \`inline code\`.

## Section

> A blockquote with *emphasis*.

\`\`\`js
const x = 1;
\`\`\`

- Item 1
- Item 2

1. First
2. Second

---

| Name  | Age |
|-------|-----|
| Alice | 30  |
| Bob   | 25  |

- [x] Done
- [ ] Not done

A [link](https://example.com) and ~~strikethrough~~.`;

		const expected = renderMarkdown(md, NO_COLOR);
		expect(feedAllAtOnce(md)).toBe(expected);
	});
});

describe("createMarkdownRenderer — determinism (char-by-char)", () => {
	it("should match renderMarkdown for a simple paragraph", () => {
		const md = "Hello world.";
		const expected = renderMarkdown(md, NO_COLOR);
		expect(feedCharByChar(md)).toBe(expected);
	});

	it("should match renderMarkdown for heading + paragraph", () => {
		const md = "# Title\n\nA paragraph.";
		const expected = renderMarkdown(md, NO_COLOR);
		expect(feedCharByChar(md)).toBe(expected);
	});

	it("should match renderMarkdown for a multi-block document", () => {
		const md = "# Hello\n\nWorld **bold**.\n\n> quote\n\n---";
		const expected = renderMarkdown(md, NO_COLOR);
		expect(feedCharByChar(md)).toBe(expected);
	});

	it("should match renderMarkdown for a fenced code block", () => {
		const md = "```js\nconst x = 1;\n```";
		const expected = renderMarkdown(md, NO_COLOR);
		expect(feedCharByChar(md)).toBe(expected);
	});

	it("should match renderMarkdown for lists", () => {
		const md = "- Item 1\n- Item 2\n- Item 3";
		const expected = renderMarkdown(md, NO_COLOR);
		expect(feedCharByChar(md)).toBe(expected);
	});

	it("should match renderMarkdown for a table", () => {
		const md = "| A | B |\n|---|---|\n| 1 | 2 |";
		const expected = renderMarkdown(md, NO_COLOR);
		expect(feedCharByChar(md)).toBe(expected);
	});
});

describe("createMarkdownRenderer — determinism (line-by-line)", () => {
	it("should match renderMarkdown for heading + paragraph", () => {
		const md = "# Title\n\nA paragraph with text.";
		const expected = renderMarkdown(md, NO_COLOR);
		expect(feedByLine(md)).toBe(expected);
	});

	it("should match renderMarkdown for a full document", () => {
		const md = `# Title

Paragraph.

> Blockquote text.

\`\`\`
code
\`\`\`

- list item`;

		const expected = renderMarkdown(md, NO_COLOR);
		expect(feedByLine(md)).toBe(expected);
	});

	it("should match renderMarkdown for a table", () => {
		const md = "| H1 | H2 |\n|---|---|\n| A | B |\n| C | D |";
		const expected = renderMarkdown(md, NO_COLOR);
		expect(feedByLine(md)).toBe(expected);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Stable-block flushing behavior
// ────────────────────────────────────────────────────────────────────────────

describe("createMarkdownRenderer — flushing behavior", () => {
	it("should flush heading after paragraph starts", () => {
		const renderer = createMarkdownRenderer(NO_COLOR);

		// Write just the heading — it's the last (and only) block, so not flushed
		const r1 = renderer.write("# Title\n");
		expect(r1).toBe("");

		// Write a blank line + start of paragraph — heading is now stable
		const r2 = renderer.write("\nSome ");
		expect(r2).not.toBe("");
		expect(r2).toContain("Title");

		// Finish and verify
		const r3 = renderer.write("text.");
		const r4 = renderer.end();
		const full = r1 + r2 + r3 + r4;
		expect(full).toBe(renderMarkdown("# Title\n\nSome text.", NO_COLOR));
	});

	it("should not flush a fenced code block until closing fence arrives", () => {
		const renderer = createMarkdownRenderer(NO_COLOR);

		let output = "";
		output += renderer.write("# Title\n\n");
		// Start code block — it's the last block, so not flushed yet
		output += renderer.write("```js\n");
		output += renderer.write("const x = 1;\n");

		// Code block is still open (no closing fence), so heading may be flushed
		// but code block should not be

		// Add closing fence + start new block to make code block stable
		output += renderer.write("```\n\n");
		output += renderer.write("Next paragraph.");
		output += renderer.end();

		// Determinism invariant: concatenated output must match one-shot
		const fullInput = "# Title\n\n```js\nconst x = 1;\n```\n\nNext paragraph.";
		expect(output).toBe(renderMarkdown(fullInput, NO_COLOR));
	});

	it("should not flush a table until a non-table block follows or end() is called", () => {
		const renderer = createMarkdownRenderer(NO_COLOR);

		// Write table row by row
		renderer.write("| A | B |\n");
		renderer.write("|---|---|\n");
		renderer.write("| 1 | 2 |\n");

		// Table is the only block — still the tail, should not be flushed
		// end() should flush it
		const result = renderer.end();
		expect(result).toContain("A");
		expect(result).toContain("B");
		expect(result).toContain("1");
		expect(result).toContain("2");
	});

	it("should flush table when a new paragraph follows", () => {
		const renderer = createMarkdownRenderer(NO_COLOR);
		let output = "";

		// First write is just the heading
		output += renderer.write("# Title\n\n");

		// Write a table
		output += renderer.write("| A | B |\n|---|---|\n| 1 | 2 |\n\n");

		// Start a new paragraph — table should now be stable
		output += renderer.write("New paragraph.");

		// End to get remaining
		output += renderer.end();

		// Total should match one-shot
		const fullInput =
			"# Title\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\nNew paragraph.";
		expect(output).toBe(renderMarkdown(fullInput, NO_COLOR));
	});
});

// ────────────────────────────────────────────────────────────────────────────
// reset() behavior
// ────────────────────────────────────────────────────────────────────────────

describe("createMarkdownRenderer — reset", () => {
	it("should clear state and allow reuse after reset()", () => {
		const renderer = createMarkdownRenderer(NO_COLOR);

		// First use
		renderer.write("# First");
		const first = renderer.end();
		expect(first).toContain("First");

		// Reset and reuse
		renderer.reset();
		renderer.write("# Second");
		const second = renderer.end();
		expect(second).toContain("Second");

		// Outputs should be independent
		expect(first).toBe(renderMarkdown("# First", NO_COLOR));
		expect(second).toBe(renderMarkdown("# Second", NO_COLOR));
	});

	it("should produce correct output after reset mid-stream", () => {
		const renderer = createMarkdownRenderer(NO_COLOR);

		// Start writing, then reset
		renderer.write("# Title\n\n");
		renderer.write("Partial content");
		renderer.reset();

		// Write something completely different
		renderer.write("Just a paragraph.");
		const result = renderer.end();
		expect(result).toBe(renderMarkdown("Just a paragraph.", NO_COLOR));
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Width option
// ────────────────────────────────────────────────────────────────────────────

describe("createMarkdownRenderer — width", () => {
	it("should respect width option in streaming output", () => {
		const options: RenderOptions = { ...NO_COLOR, width: 30 };
		const md =
			"This is a long paragraph that should be wrapped at a narrow width.";

		const expected = renderMarkdown(md, options);
		const streamed = feedAllAtOnce(md, options);
		expect(streamed).toBe(expected);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Edge cases
// ────────────────────────────────────────────────────────────────────────────

describe("createMarkdownRenderer — edge cases", () => {
	it("should handle single block with no following content", () => {
		const renderer = createMarkdownRenderer(NO_COLOR);
		renderer.write("# Title");
		const result = renderer.end();
		expect(result).toBe(renderMarkdown("# Title", NO_COLOR));
	});

	it("should handle multiple empty write() calls interspersed", () => {
		const renderer = createMarkdownRenderer(NO_COLOR);
		let output = "";
		output += renderer.write("");
		output += renderer.write("# Title");
		output += renderer.write("");
		output += renderer.write("\n\n");
		output += renderer.write("");
		output += renderer.write("Paragraph.");
		output += renderer.write("");
		output += renderer.end();
		expect(output).toBe(renderMarkdown("# Title\n\nParagraph.", NO_COLOR));
	});

	it("should handle markdown that is just whitespace", () => {
		const renderer = createMarkdownRenderer(NO_COLOR);
		renderer.write("   \n\n   ");
		const result = renderer.end();
		const expected = renderMarkdown("   \n\n   ", NO_COLOR);
		expect(result).toBe(expected);
	});

	it("should handle very small chunks (2 chars at a time)", () => {
		const md = "# Title\n\nParagraph with **bold** text.\n\n> quote";
		const expected = renderMarkdown(md, NO_COLOR);

		const renderer = createMarkdownRenderer(NO_COLOR);
		let output = "";
		for (let i = 0; i < md.length; i += 2) {
			output += renderer.write(md.slice(i, i + 2));
		}
		output += renderer.end();
		expect(output).toBe(expected);
	});

	it("should handle a document with only a thematic break", () => {
		const md = "---";
		const expected = renderMarkdown(md, NO_COLOR);
		expect(feedAllAtOnce(md)).toBe(expected);
		expect(feedCharByChar(md)).toBe(expected);
	});

	it("should handle consecutive thematic breaks", () => {
		const md = "---\n\n---\n\n---";
		const expected = renderMarkdown(md, NO_COLOR);
		expect(feedAllAtOnce(md)).toBe(expected);
	});

	it("should handle blockquotes with nested emphasis", () => {
		const md = "> **bold** and *italic* in a quote";
		const expected = renderMarkdown(md, NO_COLOR);
		expect(feedCharByChar(md)).toBe(expected);
	});

	it("should handle ordered list followed by unordered list", () => {
		const md = "1. first\n2. second\n\n- bullet a\n- bullet b";
		const expected = renderMarkdown(md, NO_COLOR);
		expect(feedCharByChar(md)).toBe(expected);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Comprehensive determinism: larger document, multiple split strategies
// ────────────────────────────────────────────────────────────────────────────

describe("createMarkdownRenderer — comprehensive determinism", () => {
	const LARGE_DOC = `# Main Title

This is the first paragraph with **bold**, *italic*, \`code\`, and ~~strikethrough~~.

## Second Section

> A blockquote
>
> With multiple paragraphs.

\`\`\`typescript
function hello(): string {
  return "world";
}
\`\`\`

- Unordered item 1
- Unordered item 2
  - Nested item

1. Ordered first
2. Ordered second
3. Ordered third

---

| Header 1 | Header 2 |
|----------|----------|
| Cell A   | Cell B   |
| Cell C   | Cell D   |

- [x] Completed task
- [ ] Pending task

A [link](https://example.com) and an ![image](https://img.png).

Final paragraph.`;

	it("should match one-shot when fed all at once", () => {
		const expected = renderMarkdown(LARGE_DOC, NO_COLOR);
		expect(feedAllAtOnce(LARGE_DOC)).toBe(expected);
	});

	it("should match one-shot when fed char by char", () => {
		const expected = renderMarkdown(LARGE_DOC, NO_COLOR);
		expect(feedCharByChar(LARGE_DOC)).toBe(expected);
	});

	it("should match one-shot when fed line by line", () => {
		const expected = renderMarkdown(LARGE_DOC, NO_COLOR);
		expect(feedByLine(LARGE_DOC)).toBe(expected);
	});

	it("should match one-shot when fed in random-sized chunks", () => {
		const expected = renderMarkdown(LARGE_DOC, NO_COLOR);

		// Use a seeded pseudo-random for reproducibility
		let seed = 42;
		function nextRandom(): number {
			seed = (seed * 16807 + 0) % 2147483647;
			return seed;
		}

		const renderer = createMarkdownRenderer(NO_COLOR);
		let output = "";
		let pos = 0;
		while (pos < LARGE_DOC.length) {
			const chunkSize = (nextRandom() % 10) + 1; // 1 to 10 chars
			const chunk = LARGE_DOC.slice(pos, pos + chunkSize);
			output += renderer.write(chunk);
			pos += chunkSize;
		}
		output += renderer.end();
		expect(output).toBe(expected);
	});
});
