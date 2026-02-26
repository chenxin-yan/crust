// ────────────────────────────────────────────────────────────────────────────
// Streaming determinism fuzz tests and edge-case chunk-boundary tests
//
// Enforces the core SPEC.md constraint: one-shot render output must exactly
// equal concatenated streaming output for the same input and options.
// ────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "bun:test";
import { renderMarkdown } from "../src/renderMarkdown.ts";
import { createMarkdownRenderer } from "../src/streaming.ts";
import type { RenderOptions } from "../src/types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/** No-color options for deterministic assertions. */
const NO_COLOR: RenderOptions = { style: { mode: "never" } };

/**
 * Split a string at every possible single-byte boundary and feed each pair
 * of chunks through a streaming renderer, asserting the concatenated output
 * matches `renderMarkdown` of the full string.
 *
 * For a string of length N, this produces N-1 two-chunk splits plus the
 * degenerate cases (empty first / empty second).
 */
function assertAllByteBoundarySplits(
	markdown: string,
	options: RenderOptions = NO_COLOR,
): void {
	const expected = renderMarkdown(markdown, options);

	// Include split at 0 (empty first chunk) and at length (empty second chunk)
	for (let i = 0; i <= markdown.length; i++) {
		const chunk1 = markdown.slice(0, i);
		const chunk2 = markdown.slice(i);

		const renderer = createMarkdownRenderer(options);
		let output = "";
		if (chunk1) output += renderer.write(chunk1);
		if (chunk2) output += renderer.write(chunk2);
		output += renderer.end();

		if (output !== expected) {
			throw new Error(
				`Determinism violation at split index ${i}.\n` +
					`  chunk1: ${JSON.stringify(chunk1)}\n` +
					`  chunk2: ${JSON.stringify(chunk2)}\n` +
					`  expected: ${JSON.stringify(expected)}\n` +
					`  actual:   ${JSON.stringify(output)}`,
			);
		}
	}
}

/**
 * Feed markdown through a streaming renderer using randomly-sized chunks.
 * Returns the concatenated output.
 */
function feedRandomChunks(
	markdown: string,
	splitPoints: number[],
	options: RenderOptions = NO_COLOR,
): string {
	const renderer = createMarkdownRenderer(options);
	let output = "";
	let pos = 0;

	for (const point of splitPoints) {
		const end = Math.min(Math.max(point, pos), markdown.length);
		const chunk = markdown.slice(pos, end);
		if (chunk) output += renderer.write(chunk);
		pos = end;
	}

	// Write any remaining content
	if (pos < markdown.length) {
		output += renderer.write(markdown.slice(pos));
	}

	output += renderer.end();
	return output;
}

// ────────────────────────────────────────────────────────────────────────────
// Exhaustive byte-boundary tests for specific edge-case fixtures
// ────────────────────────────────────────────────────────────────────────────

describe("streaming determinism — byte-boundary splits", () => {
	it("heading immediately followed by a fenced code block", () => {
		const md = "# Heading\n\n```js\nconst x = 1;\nconsole.log(x);\n```";
		assertAllByteBoundarySplits(md);
	});

	it("fenced code block where closing ``` is split across chunks", () => {
		const md = "```python\ndef foo():\n    pass\n```";
		assertAllByteBoundarySplits(md);
	});

	it("table where a row delimiter | is a chunk boundary", () => {
		const md = "| Name | Age |\n|------|-----|\n| Alice | 30 |\n| Bob | 25 |";
		assertAllByteBoundarySplits(md);
	});

	it("nested blockquotes with emphasis", () => {
		const md =
			"> Outer *emphasis*\n>\n> > Inner **strong** and ~~strike~~\n>\n> Back to outer.";
		assertAllByteBoundarySplits(md);
	});

	it("ordered list followed by an unordered list", () => {
		const md = "1. First item\n2. Second item\n\n- Bullet a\n- Bullet b";
		assertAllByteBoundarySplits(md);
	});

	it("link where ]( is split across chunks", () => {
		const md = "Check out [this link](https://example.com) for more info.";
		assertAllByteBoundarySplits(md);
	});

	it("thematic break (---) that could be confused with heading or list marker", () => {
		const md = "Some text.\n\n---\n\nMore text.";
		assertAllByteBoundarySplits(md);
	});

	it("task list items", () => {
		const md = "- [x] Completed task\n- [ ] Pending task\n- Regular item";
		assertAllByteBoundarySplits(md);
	});

	it("inline code with backticks near chunk boundary", () => {
		const md = "Use `Array.from()` and `Object.keys()` here.";
		assertAllByteBoundarySplits(md);
	});

	it("image with alt text and url", () => {
		const md =
			"Here is an image: ![alt text](https://example.com/img.png) in the middle.";
		assertAllByteBoundarySplits(md);
	});

	it("autolink", () => {
		const md = "Visit <https://example.com> for details.";
		assertAllByteBoundarySplits(md);
	});

	it("strikethrough split across chunks", () => {
		const md = "This has ~~deleted text~~ in it.";
		assertAllByteBoundarySplits(md);
	});

	it("multiple headings in sequence", () => {
		const md = "# H1\n\n## H2\n\n### H3\n\n#### H4\n\n##### H5\n\n###### H6";
		assertAllByteBoundarySplits(md);
	});

	it("blockquote followed immediately by code block", () => {
		const md = "> A blockquote\n\n```\ncode block\n```";
		assertAllByteBoundarySplits(md);
	});

	it("empty fenced code block", () => {
		const md = "Before.\n\n```\n```\n\nAfter.";
		assertAllByteBoundarySplits(md);
	});

	it("list with nested paragraphs and code", () => {
		const md =
			"- Item 1\n\n  Paragraph in item.\n\n- Item 2\n\n  ```\n  code\n  ```";
		assertAllByteBoundarySplits(md);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Randomized fuzz tests with a large GFM document
// ────────────────────────────────────────────────────────────────────────────

describe("streaming determinism — randomized fuzz", () => {
	/**
	 * A large (~500 line equivalent) GFM document exercising many node types.
	 */
	const LARGE_GFM_DOCUMENT = `# Project Documentation

This is a comprehensive document that tests streaming determinism across
many different markdown constructs. It contains **bold text**, *italic text*,
\`inline code\`, ~~strikethrough~~, and [links](https://example.com).

## Installation

Install the package using your preferred package manager:

\`\`\`bash
npm install @example/package
# or
yarn add @example/package
# or
bun add @example/package
\`\`\`

## Quick Start

> **Note**: Make sure you have Node.js 18+ installed before proceeding.
> This is required for ESM module support.

### Basic Usage

\`\`\`typescript
import { createRenderer } from "@example/package";

const renderer = createRenderer({
  width: 80,
  theme: "default",
});

const output = renderer.render("# Hello World");
console.log(output);
\`\`\`

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| width | number | 80 | Terminal width for wrapping |
| theme | string | "default" | Color theme to use |
| mode | string | "auto" | Color mode (auto/always/never) |
| softWrap | boolean | true | Enable soft word wrapping |

## Features

### Text Formatting

The renderer supports all standard GFM inline formatting:

- **Bold text** for emphasis
- *Italic text* for subtle emphasis
- ***Bold and italic*** combined
- ~~Strikethrough~~ for deleted content
- \`Inline code\` for code references

### Links and Images

Here are examples of different link types:

1. [Regular link](https://example.com)
2. [Link with title](https://example.com "Example")
3. <https://autolink.example.com>
4. ![Image alt text](https://example.com/image.png)

### Lists

#### Unordered Lists

- First level item
  - Second level item
    - Third level item
  - Another second level
- Back to first level

#### Ordered Lists

1. First item
2. Second item
3. Third item
   1. Nested first
   2. Nested second
4. Fourth item

#### Task Lists

- [x] Implement parser
- [x] Add inline rendering
- [x] Add block rendering
- [ ] Add streaming support
- [ ] Write documentation
- [ ] Release v1.0

### Code Blocks

Fenced code blocks with language annotations:

\`\`\`javascript
function fibonacci(n) {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

for (let i = 0; i < 10; i++) {
  console.log(fibonacci(i));
}
\`\`\`

\`\`\`python
def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n - 1) + fibonacci(n - 2)

for i in range(10):
    print(fibonacci(i))
\`\`\`

A code block without language:

\`\`\`
plain text code block
with multiple lines
and no syntax highlighting
\`\`\`

### Blockquotes

> Simple blockquote with a single paragraph.

> Multi-paragraph blockquote.
>
> Second paragraph with **bold** and *italic*.
>
> > Nested blockquote with \`inline code\`.
>
> Back to outer level.

### Tables

Simple table:

| Column A | Column B | Column C |
|----------|----------|----------|
| A1 | B1 | C1 |
| A2 | B2 | C2 |
| A3 | B3 | C3 |

Table with alignment:

| Left | Center | Right |
|:-----|:------:|------:|
| L1 | C1 | R1 |
| L2 | C2 | R2 |
| L3 | C3 | R3 |

### Thematic Breaks

Content before the break.

---

Content after the first break.

---

Content after the second break.

## API Reference

### \`renderMarkdown(input, options)\`

Renders a markdown string to terminal output.

**Parameters:**

- \`input\` (string) — The markdown source
- \`options\` (RenderOptions) — Optional configuration
  - \`width\` (number) — Terminal width (default: 80)
  - \`theme\` (MarkdownTheme) — Custom theme
  - \`style\` (StyleOptions) — Style configuration

**Returns:** string — The rendered terminal output.

### \`createMarkdownRenderer(options)\`

Creates a streaming renderer.

**Returns:** An object with:

1. \`write(chunk)\` — Append markdown, get stable output
2. \`end()\` — Flush remaining content
3. \`reset()\` — Clear state for reuse

## Edge Cases

### Empty Content

Empty paragraphs and whitespace-only content should be handled gracefully.

### Mixed Inline Formatting

This paragraph has **bold *and italic* together**, plus \`code with **stars** inside\`,
and a [link with *emphasis*](https://example.com).

### Long Lines

This is an intentionally long line that should be wrapped by the renderer when a width constraint is set because it exceeds the typical terminal width of eighty columns and needs to be broken.

### Unicode Content

Support for unicode: arrows, dashes, and special characters.

### Consecutive Blocks

> Quote one

> Quote two

> Quote three

\`\`\`
code one
\`\`\`

\`\`\`
code two
\`\`\`

- list one item
- list one item

- list two item
- list two item

## Conclusion

This document exercises a wide variety of GFM constructs to test the
streaming determinism invariant. The concatenated output of streaming
chunks must **exactly** match the one-shot rendered output.`;

	it("should match one-shot output for 20 random split-point sets", () => {
		const expected = renderMarkdown(LARGE_GFM_DOCUMENT, NO_COLOR);

		// Simple PRNG for reproducibility
		let seed = 12345;
		function nextRandom(): number {
			seed = (seed * 16807 + 0) % 2147483647;
			return seed;
		}

		for (let trial = 0; trial < 20; trial++) {
			// Generate 20 random split points for this trial
			const numSplits = 20;
			const splitPoints: number[] = [];
			for (let j = 0; j < numSplits; j++) {
				splitPoints.push(nextRandom() % (LARGE_GFM_DOCUMENT.length + 1));
			}
			// Sort to create ordered chunk boundaries
			splitPoints.sort((a, b) => a - b);

			const output = feedRandomChunks(
				LARGE_GFM_DOCUMENT,
				splitPoints,
				NO_COLOR,
			);

			if (output !== expected) {
				throw new Error(
					`Determinism violation on fuzz trial ${trial}.\n` +
						`  splitPoints: [${splitPoints.join(", ")}]\n` +
						`  expected length: ${expected.length}\n` +
						`  actual length:   ${output.length}`,
				);
			}
		}
	});

	it("should match one-shot output when split at every paragraph boundary", () => {
		const expected = renderMarkdown(LARGE_GFM_DOCUMENT, NO_COLOR);
		const renderer = createMarkdownRenderer(NO_COLOR);
		let output = "";

		// Split at every double-newline (paragraph boundary)
		const segments = LARGE_GFM_DOCUMENT.split("\n\n");
		for (let i = 0; i < segments.length; i++) {
			const chunk =
				i < segments.length - 1 ? `${segments[i]}\n\n` : (segments[i] ?? "");
			if (chunk) output += renderer.write(chunk);
		}
		output += renderer.end();
		expect(output).toBe(expected);
	});

	it("should match one-shot output when split at every newline", () => {
		const expected = renderMarkdown(LARGE_GFM_DOCUMENT, NO_COLOR);
		const renderer = createMarkdownRenderer(NO_COLOR);
		let output = "";

		const lines = LARGE_GFM_DOCUMENT.split("\n");
		for (let i = 0; i < lines.length; i++) {
			const chunk = i < lines.length - 1 ? `${lines[i]}\n` : (lines[i] ?? "");
			if (chunk) output += renderer.write(chunk);
		}
		output += renderer.end();
		expect(output).toBe(expected);
	});

	it("should match one-shot output with fixed 17-byte chunks", () => {
		const expected = renderMarkdown(LARGE_GFM_DOCUMENT, NO_COLOR);
		const renderer = createMarkdownRenderer(NO_COLOR);
		let output = "";

		for (let i = 0; i < LARGE_GFM_DOCUMENT.length; i += 17) {
			output += renderer.write(LARGE_GFM_DOCUMENT.slice(i, i + 17));
		}
		output += renderer.end();
		expect(output).toBe(expected);
	});

	it("should match one-shot output with fixed 31-byte chunks", () => {
		const expected = renderMarkdown(LARGE_GFM_DOCUMENT, NO_COLOR);
		const renderer = createMarkdownRenderer(NO_COLOR);
		let output = "";

		for (let i = 0; i < LARGE_GFM_DOCUMENT.length; i += 31) {
			output += renderer.write(LARGE_GFM_DOCUMENT.slice(i, i + 31));
		}
		output += renderer.end();
		expect(output).toBe(expected);
	});

	it("should match one-shot output with fixed 53-byte chunks", () => {
		const expected = renderMarkdown(LARGE_GFM_DOCUMENT, NO_COLOR);
		const renderer = createMarkdownRenderer(NO_COLOR);
		let output = "";

		for (let i = 0; i < LARGE_GFM_DOCUMENT.length; i += 53) {
			output += renderer.write(LARGE_GFM_DOCUMENT.slice(i, i + 53));
		}
		output += renderer.end();
		expect(output).toBe(expected);
	});

	it("should match one-shot output with width constraint and random chunks", () => {
		const opts: RenderOptions = { ...NO_COLOR, width: 40 };
		const expected = renderMarkdown(LARGE_GFM_DOCUMENT, opts);

		let seed = 9999;
		function nextRandom(): number {
			seed = (seed * 16807 + 0) % 2147483647;
			return seed;
		}

		const renderer = createMarkdownRenderer(opts);
		let output = "";
		let pos = 0;
		while (pos < LARGE_GFM_DOCUMENT.length) {
			const chunkSize = (nextRandom() % 15) + 1; // 1-15 chars
			output += renderer.write(LARGE_GFM_DOCUMENT.slice(pos, pos + chunkSize));
			pos += chunkSize;
		}
		output += renderer.end();
		expect(output).toBe(expected);
	});
});
