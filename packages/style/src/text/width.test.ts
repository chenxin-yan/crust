import { describe, expect, it } from "bun:test";
import { blue, red } from "../colors.ts";
import { bold } from "../modifiers.ts";
import { visibleWidth } from "./width.ts";

// ────────────────────────────────────────────────────────────────────────────
// visibleWidth — plain ASCII
// ────────────────────────────────────────────────────────────────────────────

describe("visibleWidth — plain ASCII", () => {
	it("returns 0 for empty string", () => {
		expect(visibleWidth("")).toBe(0);
	});

	it("returns correct width for ASCII text", () => {
		expect(visibleWidth("hello")).toBe(5);
	});

	it("counts spaces", () => {
		expect(visibleWidth("hello world")).toBe(11);
	});

	it("counts punctuation", () => {
		expect(visibleWidth("a.b,c!")).toBe(6);
	});

	it("handles single character", () => {
		expect(visibleWidth("x")).toBe(1);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// visibleWidth — styled text
// ────────────────────────────────────────────────────────────────────────────

describe("visibleWidth — styled text", () => {
	it("ignores bold escape sequences", () => {
		expect(visibleWidth(bold("hello"))).toBe(5);
	});

	it("ignores color escape sequences", () => {
		expect(visibleWidth(red("hello"))).toBe(5);
	});

	it("ignores nested styles", () => {
		expect(visibleWidth(bold(red("hello")))).toBe(5);
	});

	it("handles mixed styled and unstyled content", () => {
		const text = `before ${bold("middle")} after`;
		expect(visibleWidth(text)).toBe(19); // "before middle after" = 19
	});

	it("handles multiple styled segments", () => {
		const text = `${red("hello")} ${blue("world")}`;
		expect(visibleWidth(text)).toBe(11); // "hello world" = 11
	});

	it("ignores raw ANSI sequences", () => {
		expect(visibleWidth("\x1b[1mhello\x1b[22m")).toBe(5);
	});

	it("ignores reset sequences", () => {
		expect(visibleWidth("\x1b[0m")).toBe(0);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// visibleWidth — full-width characters (CJK)
// ────────────────────────────────────────────────────────────────────────────

describe("visibleWidth — full-width characters", () => {
	it("counts CJK ideographs as 2 columns", () => {
		// \u4f60 = 你, \u597d = 好
		expect(visibleWidth("\u4f60\u597d")).toBe(4);
	});

	it("counts mixed ASCII and CJK correctly", () => {
		expect(visibleWidth("hi\u4f60")).toBe(4); // "hi" (2) + 你 (2) = 4
	});

	it("counts Hiragana as full-width", () => {
		// \u3042 = あ
		expect(visibleWidth("\u3042")).toBe(2);
	});

	it("counts Katakana as full-width", () => {
		// \u30A2 = ア
		expect(visibleWidth("\u30A2")).toBe(2);
	});

	it("counts Hangul syllables as full-width", () => {
		// \uAC00 = 가
		expect(visibleWidth("\uAC00")).toBe(2);
	});

	it("counts fullwidth forms as full-width", () => {
		// \uFF21 = Ａ (fullwidth A)
		expect(visibleWidth("\uFF21")).toBe(2);
	});

	it("counts CJK with ANSI styles correctly", () => {
		expect(visibleWidth(bold("\u4f60\u597d"))).toBe(4);
	});

	it("handles mixed CJK, ASCII, and styles", () => {
		const text = `${red("\u4f60")}hi${blue("\u597d")}`;
		// 你 (2) + hi (2) + 好 (2) = 6
		expect(visibleWidth(text)).toBe(6);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// visibleWidth — edge cases
// ────────────────────────────────────────────────────────────────────────────

describe("visibleWidth — edge cases", () => {
	it("handles string with only ANSI sequences", () => {
		expect(visibleWidth("\x1b[1m\x1b[31m\x1b[22m\x1b[39m")).toBe(0);
	});

	it("handles styled empty string", () => {
		// bold("") returns "" — applyStyle short-circuits
		expect(visibleWidth(bold(""))).toBe(0);
	});
});
