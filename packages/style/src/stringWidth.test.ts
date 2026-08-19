import { describe, expect, it } from "bun:test";

import { stringWidth } from "./stringWidth.ts";

describe("stringWidth", () => {
	it("measures ANSI, combining marks, CJK, and emoji", () => {
		expect(stringWidth("\u001b[31mred\u001b[0m")).toBe(3);
		expect(stringWidth("e\u0301")).toBe(1);
		expect(stringWidth("你好")).toBe(4);
		expect(stringWidth("👨‍👩‍👧‍👦")).toBe(2);
	});

	it("handles presentation, keycaps, spacing marks, and supplementary CJK", () => {
		expect(stringWidth("©")).toBe(1); // text-presentation pictograph
		expect(stringWidth("1\uFE0F\u20E3")).toBe(2); // keycap emoji
		expect(stringWidth("का")).toBe(1); // spacing combining mark (Mc)
		expect(stringWidth("\u1112\u1161\u11AB")).toBe(2); // decomposed Hangul
		expect(stringWidth("\u{1AFF0}")).toBe(2); // Kana Extended-B
	});

	it("matches Bun for representative terminal strings", () => {
		for (const value of ["plain", "\u001b[1mbold\u001b[22m", "界", "🙂", "e\u0301"]) {
			expect(stringWidth(value)).toBe(Bun.stringWidth(value));
		}
	});
});
