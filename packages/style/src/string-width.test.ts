import { describe, expect, it } from "vite-plus/test";

import { widthCorpus } from "./string-width.corpus.ts";
import { stringWidth, stringWidthJs } from "./string-width.ts";

describe("stringWidth", () => {
	it("matches the corpus in the fallback and public API", () => {
		for (const [label, input, expected] of widthCorpus) {
			expect(stringWidthJs(input), label).toBe(expected);
			expect(stringWidth(input), label).toBe(expected);
		}
	});
});
