import { describe, expect, it } from "bun:test";
import { stripAnsi } from "@crustjs/style";
import { renderMarkdown } from "../src/renderMarkdown.ts";
import type { RenderOptions } from "../src/types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Shared test document
// ────────────────────────────────────────────────────────────────────────────

/**
 * A representative GFM document exercising many markdown constructs.
 * Used across all color-mode tests so structural comparison is meaningful.
 */
const GFM_DOC = `# Heading 1

## Heading 2

This is a paragraph with **bold**, *italic*, ~~strikethrough~~, and \`inline code\`.

> A blockquote with *emphasis* inside.

\`\`\`typescript
const x: number = 42;
\`\`\`

---

- Item one
- Item two
  - Nested item

1. First
2. Second

- [x] Done
- [ ] Pending

| Name  | Value |
|-------|------:|
| alpha |     1 |
| beta  |     2 |

[A link](https://example.com) and ![An image](https://img.png).

<div>raw html</div>
`;

const WIDTH = 80;

// ────────────────────────────────────────────────────────────────────────────
// Options per mode
// ────────────────────────────────────────────────────────────────────────────

const NEVER_OPTS: RenderOptions = { width: WIDTH, style: { mode: "never" } };
const ALWAYS_OPTS: RenderOptions = { width: WIDTH, style: { mode: "always" } };
/**
 * "auto" mode with overrides that simulate a non-TTY environment where
 * NO_COLOR is not set — the exact behavior depends on the runtime, but
 * we override `isTTY: false` to get consistent non-colored output and
 * leave noColor unset.
 */
const AUTO_OPTS: RenderOptions = {
	width: WIDTH,
	style: { mode: "auto", overrides: { isTTY: false } },
};

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/** Regex that matches any ANSI escape sequence (CSI, OSC, SGR, etc.). */
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI detection requires matching ESC (U+001B) control characters
const ANSI_RE = /\x1b\[[\d;]*[A-Za-z]|\x1b\]\d+;[^\x07]*\x07|\x1b[()#][A-Z0-9]/;

/** Returns true if the string contains at least one ANSI escape sequence. */
function containsAnsi(text: string): boolean {
	return ANSI_RE.test(text);
}

/**
 * Count visible (non-empty) lines after stripping ANSI and trimming.
 * Empty lines are kept in the count to compare structural shape.
 */
function lineCount(text: string): number {
	return text.split("\n").length;
}

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe("color-mode integration — never", () => {
	it("should produce output with no ANSI escape sequences", () => {
		const output = renderMarkdown(GFM_DOC, NEVER_OPTS);
		expect(containsAnsi(output)).toBe(false);
	});

	it("should equal its own stripAnsi output (idempotent)", () => {
		const output = renderMarkdown(GFM_DOC, NEVER_OPTS);
		expect(stripAnsi(output)).toBe(output);
	});
});

describe("color-mode integration — always", () => {
	it("should produce output containing ANSI escape sequences", () => {
		const output = renderMarkdown(GFM_DOC, ALWAYS_OPTS);
		expect(containsAnsi(output)).toBe(true);
	});

	it("should have ANSI sequences for styled constructs", () => {
		// Headings, bold, italic, etc. should all contribute ANSI codes
		const output = renderMarkdown(GFM_DOC, ALWAYS_OPTS);
		// Multiple distinct ANSI sequences should appear
		// biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI SGR sequences
		const matches = output.match(/\x1b\[[\d;]*m/g);
		expect(matches).not.toBeNull();
		expect(matches?.length).toBeGreaterThan(5);
	});
});

describe("color-mode integration — auto (non-TTY)", () => {
	it("should produce output with no ANSI when isTTY is false", () => {
		const output = renderMarkdown(GFM_DOC, AUTO_OPTS);
		// In auto mode with isTTY: false, output should be plain
		expect(containsAnsi(output)).toBe(false);
	});
});

describe("color-mode integration — structural equivalence across modes", () => {
	const neverOutput = renderMarkdown(GFM_DOC, NEVER_OPTS);
	const alwaysOutput = renderMarkdown(GFM_DOC, ALWAYS_OPTS);
	const autoOutput = renderMarkdown(GFM_DOC, AUTO_OPTS);

	it("should have the same line count across all modes", () => {
		const neverLines = lineCount(neverOutput);
		const alwaysLines = lineCount(alwaysOutput);
		const autoLines = lineCount(autoOutput);

		expect(alwaysLines).toBe(neverLines);
		expect(autoLines).toBe(neverLines);
	});

	it("should have identical visible text between never and always modes", () => {
		const strippedAlways = stripAnsi(alwaysOutput);
		expect(strippedAlways).toBe(neverOutput);
	});

	it("should have identical visible text between never and auto (non-TTY) modes", () => {
		const strippedAuto = stripAnsi(autoOutput);
		expect(strippedAuto).toBe(neverOutput);
	});

	it("should contain the same visible content keywords in all modes", () => {
		const keywords = [
			"Heading 1",
			"Heading 2",
			"bold",
			"italic",
			"strikethrough",
			"inline code",
			"blockquote",
			"emphasis",
			"typescript",
			"const x",
			"Item one",
			"Item two",
			"Nested item",
			"First",
			"Second",
			"Done",
			"Pending",
			"Name",
			"Value",
			"alpha",
			"beta",
			"A link",
			"example.com",
			"An image",
			"raw html",
		];

		for (const keyword of keywords) {
			expect(stripAnsi(neverOutput)).toContain(keyword);
			expect(stripAnsi(alwaysOutput)).toContain(keyword);
			expect(stripAnsi(autoOutput)).toContain(keyword);
		}
	});
});
