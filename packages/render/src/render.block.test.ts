import { describe, expect, it } from "bun:test";
import { parseMd } from "./parse.ts";
import { renderBlocks } from "./render.ts";
import { createMarkdownTheme } from "./theme/createMarkdownTheme.ts";
import type { RenderContext } from "./types.ts";

/**
 * Create a deterministic render context with no color output.
 * Using mode 'never' ensures assertions don't depend on ANSI sequences.
 */
function createTestContext(width = 80): RenderContext {
	return {
		theme: createMarkdownTheme({ style: { mode: "never" } }),
		width,
		indent: "",
	};
}

/**
 * Helper: parse markdown and render all blocks.
 */
function render(md: string, width = 80): string {
	const ctx = createTestContext(width);
	const tree = parseMd(md);
	return renderBlocks(tree.children, ctx);
}

// ────────────────────────────────────────────────────────────────────────────
// Headings
// ────────────────────────────────────────────────────────────────────────────

describe("renderBlocks — headings", () => {
	it("should render heading level 1", () => {
		const result = render("# Title");
		expect(result).toBe("Title");
	});

	it("should render heading level 2", () => {
		const result = render("## Subtitle");
		expect(result).toBe("Subtitle");
	});

	it("should render heading level 3", () => {
		const result = render("### Section");
		expect(result).toBe("Section");
	});

	it("should render heading level 4", () => {
		const result = render("#### Subsection");
		expect(result).toBe("Subsection");
	});

	it("should render heading level 5", () => {
		const result = render("##### Minor");
		expect(result).toBe("Minor");
	});

	it("should render heading level 6", () => {
		const result = render("###### Smallest");
		expect(result).toBe("Smallest");
	});

	it("should render heading with inline formatting", () => {
		const result = render("# Hello **world** and *italic*");
		expect(result).toBe("Hello world and italic");
	});

	it("should separate heading from following paragraph with blank line", () => {
		const result = render("# Title\n\nSome text.");
		expect(result).toBe("Title\n\nSome text.");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Paragraphs
// ────────────────────────────────────────────────────────────────────────────

describe("renderBlocks — paragraphs", () => {
	it("should render a simple paragraph", () => {
		const result = render("Hello world.");
		expect(result).toBe("Hello world.");
	});

	it("should separate two paragraphs with a blank line", () => {
		const result = render("First paragraph.\n\nSecond paragraph.");
		expect(result).toBe("First paragraph.\n\nSecond paragraph.");
	});

	it("should wrap long paragraphs to the specified width", () => {
		const longText =
			"This is a very long paragraph that should be wrapped to fit within the specified terminal width constraint.";
		const result = render(longText, 40);
		const lines = result.split("\n");
		for (const line of lines) {
			expect(line.length).toBeLessThanOrEqual(40);
		}
		// All words should be present in the wrapped output
		expect(result.replace(/\n/g, " ")).toContain("very long paragraph");
	});

	it("should render paragraph with inline formatting", () => {
		const result = render("Some **bold** and *italic* text.");
		expect(result).toBe("Some bold and italic text.");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Blockquotes
// ────────────────────────────────────────────────────────────────────────────

describe("renderBlocks — blockquotes", () => {
	it("should render a simple blockquote", () => {
		const result = render("> quoted text");
		expect(result).toBe("> quoted text");
	});

	it("should render a multi-line blockquote", () => {
		const result = render("> line one\n> line two");
		// mdast may parse this as a single paragraph with soft break
		expect(result).toContain("> ");
		expect(result).toContain("line one");
		expect(result).toContain("line two");
	});

	it("should render nested blockquotes", () => {
		const result = render("> outer\n>\n> > inner");
		expect(result).toContain("> ");
		expect(result).toContain("outer");
		expect(result).toContain("inner");
		// Inner blockquote should have double markers
		const lines = result.split("\n");
		const innerLine = lines.find((l) => l.includes("inner"));
		expect(innerLine).toBeDefined();
		// Should have nested `> > ` prefix
		expect(innerLine).toMatch(/^> > /);
	});

	it("should render blockquote with formatted content", () => {
		const result = render("> **bold** and *italic*");
		expect(result).toBe("> bold and italic");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Code blocks
// ────────────────────────────────────────────────────────────────────────────

describe("renderBlocks — code blocks", () => {
	it("should render a code block without language", () => {
		const result = render("```\nconst x = 1;\n```");
		expect(result).toContain("```");
		expect(result).toContain("const x = 1;");
		// Should have opening and closing fences
		const lines = result.split("\n");
		expect(lines[0]).toBe("```");
		expect(lines[lines.length - 1]).toBe("```");
	});

	it("should render a code block with language", () => {
		const result = render("```typescript\nconst x: number = 1;\n```");
		const lines = result.split("\n");
		expect(lines[0]).toBe("```typescript");
		expect(lines[1]).toBe("const x: number = 1;");
		expect(lines[2]).toBe("```");
	});

	it("should render a multi-line code block", () => {
		const md = "```js\nfunction add(a, b) {\n  return a + b;\n}\n```";
		const result = render(md);
		expect(result).toContain("function add(a, b) {");
		expect(result).toContain("  return a + b;");
		expect(result).toContain("}");
	});

	it("should render an empty code block", () => {
		const result = render("```\n```");
		const lines = result.split("\n");
		expect(lines[0]).toBe("```");
		// The code block may have an empty body line
		expect(lines[lines.length - 1]).toBe("```");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Thematic breaks
// ────────────────────────────────────────────────────────────────────────────

describe("renderBlocks — thematic breaks", () => {
	it("should render a thematic break as horizontal rule", () => {
		const result = render("---", 40);
		// Should be 40 characters wide
		expect(result).toBe("─".repeat(40));
	});

	it("should render thematic break between content", () => {
		const result = render("Above\n\n---\n\nBelow", 20);
		const parts = result.split("\n\n");
		expect(parts[0]).toBe("Above");
		expect(parts[1]).toBe("─".repeat(20));
		expect(parts[2]).toBe("Below");
	});

	it("should respect width setting for thematic break", () => {
		const result = render("---", 60);
		expect(result).toBe("─".repeat(60));
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Unordered lists
// ────────────────────────────────────────────────────────────────────────────

describe("renderBlocks — unordered lists", () => {
	it("should render a simple unordered list", () => {
		const md = "- alpha\n- beta\n- gamma";
		const result = render(md);
		const lines = result.split("\n");
		expect(lines).toHaveLength(3);
		expect(lines[0]).toContain("•");
		expect(lines[0]).toContain("alpha");
		expect(lines[1]).toContain("beta");
		expect(lines[2]).toContain("gamma");
	});

	it("should render nested unordered lists", () => {
		const md = "- parent\n  - child\n  - child 2\n- sibling";
		const result = render(md);
		expect(result).toContain("parent");
		expect(result).toContain("child");
		expect(result).toContain("sibling");
	});

	it("should wrap long list items", () => {
		const md =
			"- This is a very long list item that should wrap within the narrow width constraint given";
		const result = render(md, 30);
		const lines = result.split("\n");
		// First line has the marker, continuation lines should be indented
		expect(lines[0]).toMatch(/^• /);
		expect(lines.length).toBeGreaterThan(1);
		// Continuation lines should be indented to align with content
		for (let i = 1; i < lines.length; i++) {
			expect(lines[i]).toMatch(/^ /);
		}
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Ordered lists
// ────────────────────────────────────────────────────────────────────────────

describe("renderBlocks — ordered lists", () => {
	it("should render a simple ordered list", () => {
		const md = "1. first\n2. second\n3. third";
		const result = render(md);
		const lines = result.split("\n");
		expect(lines).toHaveLength(3);
		expect(lines[0]).toContain("1.");
		expect(lines[0]).toContain("first");
		expect(lines[1]).toContain("2.");
		expect(lines[1]).toContain("second");
		expect(lines[2]).toContain("3.");
		expect(lines[2]).toContain("third");
	});

	it("should right-align markers for multi-digit numbers", () => {
		const items = Array.from(
			{ length: 10 },
			(_, i) => `${i + 1}. item ${i + 1}`,
		).join("\n");
		const result = render(items);
		const lines = result.split("\n");
		// Items 1-9 should be right-aligned to match width of "10."
		expect(lines[0]).toMatch(/^\s*1\./);
		expect(lines[9]).toMatch(/^10\./);
	});

	it("should render ordered list with start number", () => {
		const md = "5. fifth\n6. sixth";
		const result = render(md);
		expect(result).toContain("5.");
		expect(result).toContain("sixth");
	});

	it("should render nested ordered lists", () => {
		const md = "1. outer\n   1. inner\n   2. inner 2\n2. outer 2";
		const result = render(md);
		expect(result).toContain("outer");
		expect(result).toContain("inner");
		expect(result).toContain("outer 2");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Task lists
// ────────────────────────────────────────────────────────────────────────────

describe("renderBlocks — task lists", () => {
	it("should render a task list with checked and unchecked items", () => {
		const md = "- [x] done\n- [ ] pending\n- [x] also done";
		const result = render(md);
		const lines = result.split("\n");
		expect(lines).toHaveLength(3);
		expect(lines[0]).toContain("[x]");
		expect(lines[0]).toContain("done");
		expect(lines[1]).toContain("[ ]");
		expect(lines[1]).toContain("pending");
		expect(lines[2]).toContain("[x]");
		expect(lines[2]).toContain("also done");
	});

	it("should render task list with formatting in items", () => {
		const md = "- [x] **important** task\n- [ ] *optional* task";
		const result = render(md);
		expect(result).toContain("[x]");
		expect(result).toContain("important task");
		expect(result).toContain("[ ]");
		expect(result).toContain("optional task");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Tables
// ────────────────────────────────────────────────────────────────────────────

describe("renderBlocks — tables", () => {
	it("should render a simple table", () => {
		const md = "| Name | Age |\n|------|-----|\n| Alice | 30 |\n| Bob | 25 |";
		const result = render(md);
		const lines = result.split("\n");
		expect(lines).toHaveLength(4); // header + separator + 2 data rows
		expect(lines[0]).toContain("Name");
		expect(lines[0]).toContain("Age");
		expect(lines[1]).toContain("─");
		expect(lines[2]).toContain("Alice");
		expect(lines[2]).toContain("30");
		expect(lines[3]).toContain("Bob");
		expect(lines[3]).toContain("25");
	});

	it("should render table with left alignment", () => {
		const md = "| Left |\n|:-----|\n| data |";
		const result = render(md);
		expect(result).toContain("Left");
		expect(result).toContain("data");
	});

	it("should render table with right alignment", () => {
		const md = "| Right |\n|------:|\n| data  |";
		const result = render(md);
		expect(result).toContain("Right");
		expect(result).toContain("data");
	});

	it("should render table with center alignment", () => {
		const md = "| Center |\n|:------:|\n| data   |";
		const result = render(md);
		expect(result).toContain("Center");
		expect(result).toContain("data");
	});

	it("should render table with mixed alignments", () => {
		const md =
			"| Left | Center | Right |\n|:-----|:------:|------:|\n| a | b | c |";
		const result = render(md);
		const lines = result.split("\n");
		expect(lines).toHaveLength(3);
		// All cells should be present
		expect(lines[0]).toContain("Left");
		expect(lines[0]).toContain("Center");
		expect(lines[0]).toContain("Right");
		expect(lines[2]).toContain("a");
		expect(lines[2]).toContain("b");
		expect(lines[2]).toContain("c");
	});

	it("should render table with inline formatting in cells", () => {
		const md = "| Header |\n|--------|\n| **bold** cell |";
		const result = render(md);
		expect(result).toContain("Header");
		expect(result).toContain("bold cell");
	});

	it("should use border characters between cells", () => {
		const md = "| A | B |\n|---|---|\n| 1 | 2 |";
		const result = render(md);
		// Each row should have border | characters
		const lines = result.split("\n");
		for (const line of lines) {
			expect(line).toMatch(/^\|.*\|$/);
		}
	});

	it("should handle columns with varying widths", () => {
		const md =
			"| Short | Very Long Column Header |\n|-------|------------------------|\n| x | y |";
		const result = render(md);
		expect(result).toContain("Short");
		expect(result).toContain("Very Long Column Header");
		// Column widths should accommodate longest content
		const lines = result.split("\n");
		// All rows should have the same length (aligned)
		const lengths = lines.map((l) => l.length);
		expect(new Set(lengths).size).toBe(1);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// HTML (raw)
// ────────────────────────────────────────────────────────────────────────────

describe("renderBlocks — raw HTML", () => {
	it("should render raw HTML as literal text", () => {
		const result = render("<div>hello</div>");
		expect(result).toContain("<div>hello</div>");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Mixed document
// ────────────────────────────────────────────────────────────────────────────

describe("renderBlocks — mixed document", () => {
	it("should render a document with multiple block types", () => {
		const md = [
			"# Title",
			"",
			"A paragraph with **bold**.",
			"",
			"> A quote",
			"",
			"- item 1",
			"- item 2",
			"",
			"```js",
			"code()",
			"```",
			"",
			"---",
			"",
			"| A | B |",
			"|---|---|",
			"| 1 | 2 |",
		].join("\n");

		const result = render(md, 40);

		// All block types should be present
		expect(result).toContain("Title");
		expect(result).toContain("bold");
		expect(result).toContain("> ");
		expect(result).toContain("quote");
		expect(result).toContain("•");
		expect(result).toContain("item 1");
		expect(result).toContain("```");
		expect(result).toContain("code()");
		expect(result).toContain("─");
		expect(result).toContain("| ");
	});

	it("should separate blocks with blank lines", () => {
		const md = "# Title\n\nParagraph\n\n> Quote";
		const result = render(md);
		const parts = result.split("\n\n");
		expect(parts.length).toBe(3);
		expect(parts[0]).toBe("Title");
		expect(parts[1]).toBe("Paragraph");
		expect(parts[2]).toContain("> ");
	});
});
