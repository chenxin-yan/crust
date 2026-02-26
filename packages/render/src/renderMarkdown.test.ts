import { describe, expect, it } from "bun:test";
import { stripAnsi } from "@crustjs/style";
import { renderMarkdown } from "./renderMarkdown.ts";
import type { RenderOptions } from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/** No-color options for deterministic assertions. */
const NO_COLOR: RenderOptions = { style: { mode: "never" } };

/** Render with no-color mode and optional width. */
function render(md: string, width = 80): string {
	return renderMarkdown(md, { ...NO_COLOR, width });
}

// ────────────────────────────────────────────────────────────────────────────
// Empty / edge cases
// ────────────────────────────────────────────────────────────────────────────

describe("renderMarkdown — empty / edge cases", () => {
	it("should return empty string for empty input", () => {
		expect(renderMarkdown("", NO_COLOR)).toBe("");
	});

	it("should return empty string for undefined-like empty input", () => {
		expect(renderMarkdown("", NO_COLOR)).toBe("");
	});

	it("should handle whitespace-only input", () => {
		// Whitespace-only parses to empty root children
		const result = renderMarkdown("   ", NO_COLOR);
		expect(typeof result).toBe("string");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Full GFM document integration
// ────────────────────────────────────────────────────────────────────────────

describe("renderMarkdown — full GFM document", () => {
	it("should render a complete GFM document with all constructs", () => {
		const doc = `# Main Title

This is a paragraph with **bold**, *italic*, and \`inline code\`.

## Section

> A blockquote with *emphasis*.

\`\`\`js
const x = 1;
\`\`\`

- Item 1
- Item 2
  - Nested item

1. First
2. Second

---

| Name | Age |
|------|-----|
| Alice | 30 |
| Bob   | 25 |

- [x] Done
- [ ] Not done

A [link](https://example.com) and an ![image](https://img.png).

~~strikethrough~~`;

		const result = render(doc);

		// Verify key structural elements are present
		expect(result).toContain("Main Title");
		expect(result).toContain("bold");
		expect(result).toContain("italic");
		expect(result).toContain("inline code");
		expect(result).toContain("Section");
		expect(result).toContain("> ");
		expect(result).toContain("A blockquote");
		expect(result).toContain("```");
		expect(result).toContain("js");
		expect(result).toContain("const x = 1;");
		expect(result).toContain("Item 1");
		expect(result).toContain("Item 2");
		expect(result).toContain("Nested item");
		expect(result).toContain("1.");
		expect(result).toContain("2.");
		expect(result).toContain("─"); // thematic break
		expect(result).toContain("Alice");
		expect(result).toContain("Bob");
		expect(result).toContain("|"); // table border
		expect(result).toContain("[x]");
		expect(result).toContain("[ ]");
		expect(result).toContain("link");
		expect(result).toContain("(https://example.com)");
		expect(result).toContain("image");
		expect(result).toContain("(https://img.png)");
		expect(result).toContain("strikethrough");
	});

	it("should separate top-level blocks with blank lines", () => {
		const result = render("# Heading\n\nParagraph one.\n\nParagraph two.");
		const parts = result.split("\n\n");
		expect(parts.length).toBeGreaterThanOrEqual(3);
		expect(parts[0]).toBe("Heading");
		expect(parts[1]).toBe("Paragraph one.");
		expect(parts[2]).toBe("Paragraph two.");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Width constraint
// ────────────────────────────────────────────────────────────────────────────

describe("renderMarkdown — width option", () => {
	it("should wrap paragraph text to the specified width", () => {
		const longText =
			"This is a long paragraph that should be wrapped at the specified width to ensure readability in narrow terminals.";
		const result = render(longText, 40);
		const lines = result.split("\n");

		// Every line should be within the width constraint
		for (const line of lines) {
			expect(line.length).toBeLessThanOrEqual(40);
		}
	});

	it("should use default width of 80 when not specified", () => {
		const longText = "a ".repeat(60).trim(); // 119 chars
		const result = renderMarkdown(longText, NO_COLOR);
		const lines = result.split("\n");

		// With default width 80, this should wrap
		expect(lines.length).toBeGreaterThan(1);
		for (const line of lines) {
			expect(line.length).toBeLessThanOrEqual(80);
		}
	});

	it("should respect width for thematic breaks", () => {
		const result = render("---", 30);
		expect(result).toBe("─".repeat(30));
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Custom theme overrides
// ────────────────────────────────────────────────────────────────────────────

describe("renderMarkdown — custom theme", () => {
	it("should apply partial theme overrides", () => {
		const result = renderMarkdown("# Title", {
			style: { mode: "never" },
			theme: {
				heading1: (v: string) => `>>> ${v} <<<`,
			},
		});
		expect(result).toBe(">>> Title <<<");
	});

	it("should apply multiple theme overrides while keeping defaults", () => {
		const result = renderMarkdown("**bold** and *italic*", {
			style: { mode: "never" },
			theme: {
				strong: (v: string) => `[BOLD:${v}]`,
				emphasis: (v: string) => `[ITALIC:${v}]`,
			},
		});
		expect(result).toContain("[BOLD:bold]");
		expect(result).toContain("[ITALIC:italic]");
	});

	it("should accept a full MarkdownTheme object", () => {
		// Build a full custom theme using createMarkdownTheme
		const { createMarkdownTheme } = require("./theme/createMarkdownTheme.ts");
		const fullTheme = createMarkdownTheme({
			style: { mode: "never" },
			overrides: {
				heading1: (v: string) => `=== ${v} ===`,
			},
		});

		const result = renderMarkdown("# Title", { theme: fullTheme });
		expect(result).toBe("=== Title ===");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Raw HTML passthrough
// ────────────────────────────────────────────────────────────────────────────

describe("renderMarkdown — raw HTML", () => {
	it("should pass through raw HTML as literal text", () => {
		const result = render("<div>Hello</div>");
		expect(result).toContain("<div>Hello</div>");
	});

	it("should render HTML blocks alongside regular content", () => {
		const result = render("# Title\n\n<div>HTML block</div>\n\nParagraph.");
		expect(result).toContain("Title");
		expect(result).toContain("<div>HTML block</div>");
		expect(result).toContain("Paragraph.");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Color mode integration
// ────────────────────────────────────────────────────────────────────────────

describe("renderMarkdown — color modes", () => {
	it("should produce no ANSI sequences in 'never' mode", () => {
		const result = renderMarkdown("# Hello **world**", {
			style: { mode: "never" },
		});
		expect(result).toBe(stripAnsi(result));
	});

	it("should produce ANSI sequences in 'always' mode", () => {
		const result = renderMarkdown("# Hello **world**", {
			style: { mode: "always" },
		});
		// The 'always' mode should include ANSI escapes
		expect(result).not.toBe(stripAnsi(result));
	});

	it("should produce identical visible text across color modes", () => {
		const md = "# Title\n\nSome **bold** and *italic* text.";

		const never = renderMarkdown(md, { style: { mode: "never" } });
		const always = renderMarkdown(md, { style: { mode: "always" } });

		// Stripped visible text should match
		expect(stripAnsi(always)).toBe(stripAnsi(never));
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Pipeline correctness
// ────────────────────────────────────────────────────────────────────────────

describe("renderMarkdown — pipeline", () => {
	it("should handle headings at all levels", () => {
		for (let level = 1; level <= 6; level++) {
			const md = `${"#".repeat(level)} Heading ${level}`;
			const result = render(md);
			expect(result).toContain(`Heading ${level}`);
		}
	});

	it("should handle nested blockquotes", () => {
		const result = render("> outer\n>\n> > inner");
		expect(result).toContain("> ");
		expect(result).toContain("outer");
		expect(result).toContain("inner");
	});

	it("should handle code blocks with language", () => {
		const result = render("```typescript\nconst x: number = 1;\n```");
		expect(result).toContain("```");
		expect(result).toContain("typescript");
		expect(result).toContain("const x: number = 1;");
	});

	it("should handle code blocks without language", () => {
		const result = render("```\nplain code\n```");
		expect(result).toContain("```");
		expect(result).toContain("plain code");
	});

	it("should handle mixed list types in sequence", () => {
		const md = "- unordered\n\n1. ordered\n\n- [x] task";
		const result = render(md);
		expect(result).toContain("unordered");
		expect(result).toContain("1.");
		expect(result).toContain("ordered");
		expect(result).toContain("[x]");
		expect(result).toContain("task");
	});

	it("should handle links with different formats", () => {
		const result = render("[text](https://url.com)");
		expect(result).toContain("text");
		expect(result).toContain("(https://url.com)");
	});

	it("should handle images", () => {
		const result = render("![alt text](https://img.png)");
		expect(result).toContain("alt text");
		expect(result).toContain("(https://img.png)");
	});

	it("should handle tables with alignment", () => {
		const md = `| Left | Center | Right |
|:-----|:------:|------:|
| a    | b      | c     |`;
		const result = render(md);
		expect(result).toContain("Left");
		expect(result).toContain("Center");
		expect(result).toContain("Right");
		expect(result).toContain("a");
		expect(result).toContain("b");
		expect(result).toContain("c");
	});

	it("should handle strikethrough text", () => {
		const result = render("~~deleted~~");
		expect(result).toContain("deleted");
	});

	it("should handle inline code within paragraphs", () => {
		const result = render("Use `console.log()` for debugging.");
		expect(result).toContain("console.log()");
		expect(result).toContain("debugging");
	});
});
