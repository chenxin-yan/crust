import { describe, expect, it } from "vite-plus/test";

import { widthCorpus } from "./stringWidth.corpus.ts";
import { stringWidth, stringWidthJs } from "./stringWidth.ts";

describe("stringWidth", () => {
	it("treats East-Asian-Ambiguous characters as narrow", () => {
		expect(stringWidthJs("\u2460")).toBe(1); // ① circled digit one
		expect(stringWidthJs("\u03b1")).toBe(1); // α Greek alpha
		expect(stringWidthJs("\u00b1")).toBe(1); // ± plus-minus sign
	});

	it("only shortcuts printable ASCII", () => {
		const printable = Array.from({ length: 95 }, (_, i) => String.fromCharCode(i + 32)).join("");
		expect(stringWidthJs(printable)).toBe(95);
	});

	it("matches the corpus in the fallback and public API", () => {
		for (const [label, input, expected] of widthCorpus) {
			expect(stringWidthJs(input), label).toBe(expected);
			expect(stringWidth(input), label).toBe(expected);
		}
	});
});
