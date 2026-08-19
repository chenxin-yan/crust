import { describe, expect, it } from "bun:test";

import { stringWidth, stringWidthJs } from "./stringWidth.ts";

describe("stringWidth", () => {
	it("measures ANSI, combining marks, CJK, and emoji", () => {
		expect(stringWidth("\u001b[31mred\u001b[0m")).toBe(3);
		expect(stringWidth("e\u0301")).toBe(1);
		expect(stringWidth("你好")).toBe(4);
		expect(stringWidth("👨‍👩‍👧‍👦")).toBe(2);
	});

	it("keeps fallback coverage for presentation and supplementary characters", () => {
		expect(stringWidthJs("©")).toBe(1); // text-presentation pictograph
		expect(stringWidthJs("1\uFE0F\u20E3")).toBe(2); // keycap emoji
		expect(stringWidthJs("का")).toBe(1); // spacing combining mark (Mc)
		expect(stringWidthJs("\u1112\u1161\u11AB")).toBe(2); // decomposed Hangul
		expect(stringWidthJs("\u{1AFF0}")).toBe(2); // Kana Extended-B
	});

	it("treats East-Asian-Ambiguous characters as narrow", () => {
		expect(stringWidthJs("\u2460")).toBe(1); // ① circled digit one
		expect(stringWidthJs("\u03b1")).toBe(1); // α Greek alpha
		expect(stringWidthJs("\u00b1")).toBe(1); // ± plus-minus sign
	});

	it("keeps the JavaScript fallback aligned with Bun", () => {
		// Decomposed Hangul is intentionally covered above but excluded here: Bun 1.3.14
		// reports four columns for the two-column grapheme due to Unicode implementation drift.
		for (const value of [
			"",
			"plain ASCII",
			"你好",
			"🙂",
			"👨‍👩‍👧‍👦",
			"☺️",
			"1\uFE0F\u20E3",
			"e\u0301",
			"\u001b[31mred\u001b[0m",
		]) {
			const nativeWidth = Bun.stringWidth(value, { countAnsiEscapeCodes: false });
			expect(stringWidthJs(value)).toBe(nativeWidth);
			expect(stringWidth(value)).toBe(nativeWidth);
		}
	});
});
