import { describe, expect, it } from "bun:test";
import { red } from "../colors.ts";
import { bold } from "../modifiers.ts";
import { stripAnsi } from "./stripAnsi.ts";
import { wrapText } from "./wrap.ts";

// ────────────────────────────────────────────────────────────────────────────
// wrapText — plain text, word-break mode (default)
// ────────────────────────────────────────────────────────────────────────────

describe("wrapText — plain text, word-break", () => {
	it("returns text unchanged when it fits within width", () => {
		expect(wrapText("hello", 10)).toBe("hello");
	});

	it("wraps at last space before width limit", () => {
		expect(wrapText("hello world", 7)).toBe("hello\nworld");
	});

	it("wraps long text into multiple lines", () => {
		expect(wrapText("one two three four", 9)).toBe("one two\nthree\nfour");
	});

	it("force-breaks a single word longer than width", () => {
		expect(wrapText("abcdefghij", 5)).toBe("abcde\nfghij");
	});

	it("handles width of 1", () => {
		expect(wrapText("abc", 1)).toBe("a\nb\nc");
	});

	it("returns text unchanged for width <= 0", () => {
		expect(wrapText("hello", 0)).toBe("hello");
		expect(wrapText("hello", -1)).toBe("hello");
	});

	it("returns empty string for empty input", () => {
		expect(wrapText("", 10)).toBe("");
	});

	it("preserves existing newlines", () => {
		expect(wrapText("hello\nworld", 20)).toBe("hello\nworld");
	});

	it("wraps each line independently around existing newlines", () => {
		expect(wrapText("hello world\nfoo bar", 7)).toBe("hello\nworld\nfoo bar");
	});

	it("handles trailing space", () => {
		const result = wrapText("hello ", 10);
		expect(result).toBe("hello ");
	});

	it("handles multiple spaces", () => {
		const result = wrapText("a  b", 3);
		expect(result).toBe("a \nb");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// wrapText — plain text, no word-break
// ────────────────────────────────────────────────────────────────────────────

describe("wrapText — plain text, no word-break", () => {
	it("breaks exactly at width boundary", () => {
		expect(wrapText("abcdefgh", 4, { wordBreak: false })).toBe("abcd\nefgh");
	});

	it("breaks mid-word even when spaces present", () => {
		expect(wrapText("ab cdef", 4, { wordBreak: false })).toBe("ab c\ndef");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// wrapText — styled text, style continuity
// ────────────────────────────────────────────────────────────────────────────

describe("wrapText — styled text", () => {
	it("preserves style continuity when wrapping styled text", () => {
		const styled = bold("hello world");
		const result = wrapText(styled, 7);
		const lines = result.split("\n");

		// Each line should have the same plain-text content
		expect(stripAnsi(lines[0] ?? "")).toBe("hello");
		expect(stripAnsi(lines[1] ?? "")).toBe("world");

		// First line should start with bold open
		expect(lines[0]?.startsWith("\x1b[1m")).toBe(true);
		// First line should end with reset
		expect(lines[0]?.endsWith("\x1b[0m")).toBe(true);
		// Second line should start with bold reopen
		expect(lines[1]?.startsWith("\x1b[1m")).toBe(true);
	});

	it("preserves nested styles across wrap", () => {
		const styled = bold(red("hello world"));
		const result = wrapText(styled, 7);
		const lines = result.split("\n");

		expect(stripAnsi(lines[0] ?? "")).toBe("hello");
		expect(stripAnsi(lines[1] ?? "")).toBe("world");
	});

	it("handles style starting mid-line", () => {
		const text = `hi ${bold("there buddy")}`;
		const result = wrapText(text, 10);
		const lines = result.split("\n");

		expect(stripAnsi(lines[0] ?? "")).toBe("hi there");
		expect(stripAnsi(lines[1] ?? "")).toBe("buddy");
	});

	it("handles styled text that fits without wrapping", () => {
		const styled = bold("hello");
		const result = wrapText(styled, 10);
		expect(result).toBe(styled);
	});

	it("handles mixed styled and unstyled segments", () => {
		const text = `${red("red")} plain ${bold("bold")}`;
		const result = wrapText(text, 20);
		expect(stripAnsi(result)).toBe("red plain bold");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// wrapText — full-width characters
// ────────────────────────────────────────────────────────────────────────────

describe("wrapText — full-width characters", () => {
	it("wraps CJK characters by visible width", () => {
		// Each CJK char is 2 columns wide
		// \u4f60\u597d\u4e16\u754c = 你好世界 = 8 columns
		const result = wrapText("\u4f60\u597d\u4e16\u754c", 4);
		expect(result).toBe("\u4f60\u597d\n\u4e16\u754c");
	});

	it("wraps mixed ASCII and CJK correctly", () => {
		// "hi你好" = 2 + 4 = 6 columns
		const result = wrapText("hi\u4f60\u597d", 4);
		expect(result).toBe("hi\u4f60\n\u597d");
	});

	it("does not split CJK character across lines", () => {
		// Width 3: 你 (2) fits, 好 (2) would exceed, so force break
		const result = wrapText("\u4f60\u597d", 3);
		expect(result).toBe("\u4f60\n\u597d");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// wrapText — multiline styled input
// ────────────────────────────────────────────────────────────────────────────

describe("wrapText — multiline", () => {
	it("wraps each line of multiline input independently", () => {
		const result = wrapText("hello world\nfoo bar baz", 7);
		const lines = result.split("\n");
		expect(lines).toEqual(["hello", "world", "foo", "bar baz"]);
	});

	it("preserves empty lines in multiline input", () => {
		const result = wrapText("hello\n\nworld", 10);
		expect(result).toBe("hello\n\nworld");
	});
});
