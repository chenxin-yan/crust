import { describe, expect, it } from "bun:test";
import type { PhrasingContent } from "mdast";
import { parseMd } from "./parse.ts";
import { renderInline } from "./render.ts";
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
	};
}

/**
 * Helper: parse markdown and extract inline children from the first paragraph.
 */
function getInlineNodes(md: string): PhrasingContent[] {
	const tree = parseMd(md);
	const paragraph = tree.children[0];
	if (paragraph?.type === "paragraph") {
		return paragraph.children;
	}
	return [];
}

describe("renderInline", () => {
	const ctx = createTestContext();

	describe("text", () => {
		it("should render plain text unchanged", () => {
			const nodes = getInlineNodes("hello world");
			expect(renderInline(nodes, ctx)).toBe("hello world");
		});

		it("should render empty text as empty string", () => {
			expect(renderInline([], ctx)).toBe("");
		});
	});

	describe("emphasis", () => {
		it("should render emphasized text through theme.emphasis", () => {
			const nodes = getInlineNodes("*italic*");
			const result = renderInline(nodes, ctx);
			// In 'never' mode, emphasis is identity — text passes through
			expect(result).toBe("italic");
		});

		it("should handle emphasis within surrounding text", () => {
			const nodes = getInlineNodes("before *middle* after");
			const result = renderInline(nodes, ctx);
			expect(result).toBe("before middle after");
		});
	});

	describe("strong", () => {
		it("should render strong text through theme.strong", () => {
			const nodes = getInlineNodes("**bold**");
			const result = renderInline(nodes, ctx);
			expect(result).toBe("bold");
		});

		it("should handle strong within surrounding text", () => {
			const nodes = getInlineNodes("before **middle** after");
			const result = renderInline(nodes, ctx);
			expect(result).toBe("before middle after");
		});
	});

	describe("strongEmphasis", () => {
		it("should render emphasis wrapping strong as strongEmphasis", () => {
			const nodes = getInlineNodes("***both***");
			const result = renderInline(nodes, ctx);
			// In 'never' mode, strongEmphasis is identity
			expect(result).toBe("both");
		});

		it("should handle strongEmphasis within surrounding text", () => {
			const nodes = getInlineNodes("before ***both*** after");
			const result = renderInline(nodes, ctx);
			expect(result).toBe("before both after");
		});
	});

	describe("strikethrough", () => {
		it("should render strikethrough text through theme.strikethrough", () => {
			const nodes = getInlineNodes("~~deleted~~");
			const result = renderInline(nodes, ctx);
			expect(result).toBe("deleted");
		});

		it("should handle strikethrough within surrounding text", () => {
			const nodes = getInlineNodes("before ~~middle~~ after");
			const result = renderInline(nodes, ctx);
			expect(result).toBe("before middle after");
		});
	});

	describe("inlineCode", () => {
		it("should render inline code through theme.inlineCode", () => {
			const nodes = getInlineNodes("`code`");
			const result = renderInline(nodes, ctx);
			expect(result).toBe("code");
		});

		it("should handle inline code within surrounding text", () => {
			const nodes = getInlineNodes("run `npm install` now");
			const result = renderInline(nodes, ctx);
			expect(result).toBe("run npm install now");
		});
	});

	describe("link", () => {
		it("should render a link with text and URL", () => {
			const nodes = getInlineNodes("[click here](https://example.com)");
			const result = renderInline(nodes, ctx);
			expect(result).toBe("click here (https://example.com)");
		});

		it("should handle link within surrounding text", () => {
			const nodes = getInlineNodes(
				"visit [my site](https://example.com) today",
			);
			const result = renderInline(nodes, ctx);
			expect(result).toBe("visit my site (https://example.com) today");
		});

		it("should render link with emphasis in text", () => {
			const nodes = getInlineNodes("[*emphasized link*](https://example.com)");
			const result = renderInline(nodes, ctx);
			expect(result).toBe("emphasized link (https://example.com)");
		});
	});

	describe("autolink", () => {
		it("should render autolink through theme.autolink", () => {
			const nodes = getInlineNodes("<https://example.com>");
			const result = renderInline(nodes, ctx);
			expect(result).toBe("https://example.com");
		});

		it("should handle autolink within surrounding text", () => {
			const nodes = getInlineNodes("visit <https://example.com> for info");
			const result = renderInline(nodes, ctx);
			expect(result).toBe("visit https://example.com for info");
		});
	});

	describe("image", () => {
		it("should render image with alt text and URL", () => {
			const nodes = getInlineNodes("![screenshot](image.png)");
			const result = renderInline(nodes, ctx);
			expect(result).toBe("screenshot (image.png)");
		});

		it("should render image with empty alt text", () => {
			const nodes = getInlineNodes("![](image.png)");
			const result = renderInline(nodes, ctx);
			expect(result).toBe(" (image.png)");
		});

		it("should handle image within surrounding text", () => {
			const nodes = getInlineNodes("see ![logo](logo.svg) above");
			const result = renderInline(nodes, ctx);
			expect(result).toBe("see logo (logo.svg) above");
		});
	});

	describe("break", () => {
		it("should render a hard break as newline", () => {
			// Two trailing spaces followed by newline creates a hard break
			const nodes = getInlineNodes("line one  \nline two");
			const result = renderInline(nodes, ctx);
			expect(result).toBe("line one\nline two");
		});
	});

	describe("nested inlines", () => {
		it("should handle bold inside emphasis", () => {
			const nodes = getInlineNodes("*normal and **bold** emphasis*");
			const result = renderInline(nodes, ctx);
			expect(result).toBe("normal and bold emphasis");
		});

		it("should handle code inside link", () => {
			const nodes = getInlineNodes("[`code`](https://example.com)");
			const result = renderInline(nodes, ctx);
			expect(result).toBe("code (https://example.com)");
		});

		it("should handle emphasis inside link", () => {
			const nodes = getInlineNodes("[*click*](https://example.com)");
			const result = renderInline(nodes, ctx);
			expect(result).toBe("click (https://example.com)");
		});

		it("should handle multiple inline types in sequence", () => {
			const nodes = getInlineNodes("plain **bold** *italic* `code` ~~struck~~");
			const result = renderInline(nodes, ctx);
			expect(result).toBe("plain bold italic code struck");
		});

		it("should handle strikethrough with emphasis inside", () => {
			const nodes = getInlineNodes("~~*deleted italic*~~");
			const result = renderInline(nodes, ctx);
			expect(result).toBe("deleted italic");
		});
	});

	describe("with 'always' color mode", () => {
		it("should apply ANSI styling when mode is 'always'", () => {
			const colorCtx: RenderContext = {
				theme: createMarkdownTheme({ style: { mode: "always" } }),
				width: 80,
			};
			const nodes = getInlineNodes("**bold**");
			const result = renderInline(nodes, colorCtx);
			// In 'always' mode, strong applies bold ANSI codes
			expect(result).not.toBe("bold");
			expect(result).toContain("bold");
			// Should contain ANSI escape sequences
			// biome-ignore lint/suspicious/noControlCharactersInRegex: testing for ANSI escape codes
			expect(result).toMatch(/\x1b\[/);
		});
	});

	describe("with custom theme overrides", () => {
		it("should use overridden theme slots", () => {
			const customCtx: RenderContext = {
				theme: createMarkdownTheme({
					style: { mode: "never" },
					overrides: {
						strong: (v) => `[BOLD:${v}]`,
						emphasis: (v) => `[EM:${v}]`,
						inlineCode: (v) => `[CODE:${v}]`,
					},
				}),
				width: 80,
			};

			const nodes = getInlineNodes("**bold** *em* `code`");
			const result = renderInline(nodes, customCtx);
			expect(result).toBe("[BOLD:bold] [EM:em] [CODE:code]");
		});
	});
});
