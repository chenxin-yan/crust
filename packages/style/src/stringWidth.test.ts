import { describe, expect, it } from "bun:test";

import { widthCorpus } from "./stringWidth.corpus.ts";
import { stringWidth, stringWidthJs } from "./stringWidth.ts";

const hasBunNative = globalThis.Bun?.stringWidth !== undefined;

describe("stringWidth", () => {
	it("measures ANSI, combining marks, CJK, and emoji", () => {
		expect(stringWidthJs("\u001b[31mred\u001b[0m")).toBe(3);
		expect(stringWidthJs("e\u0301")).toBe(1);
		expect(stringWidthJs("你好")).toBe(4);
		expect(stringWidthJs("👨‍👩‍👧‍👦")).toBe(2);
		expect(stringWidth("你好")).toBe(4);
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

	it("only shortcuts printable ASCII", () => {
		const printable = Array.from({ length: 95 }, (_, i) => String.fromCharCode(i + 32)).join("");
		expect(stringWidthJs(printable)).toBe(95);
		for (const [input, width] of [
			["", 0],
			["abc\n", 3],
			["abc\r\n", 3],
			["abc\x7f", 3],
			["abc\x1b[31m", 3],
			["abc你好", 7],
			["abce\u0301", 4],
		] as const) {
			expect(stringWidthJs(input)).toBe(width);
		}
	});

	it("matches the corpus in the fallback, the public API and Bun native", () => {
		for (const [label, input, expected] of widthCorpus) {
			if (hasBunNative) {
				expect(Bun.stringWidth(input, { countAnsiEscapeCodes: false }), `native: ${label}`).toBe(
					expected,
				);
			}
			expect(stringWidthJs(input), label).toBe(expected);
			expect(stringWidth(input), label).toBe(expected);
		}
	});
});
