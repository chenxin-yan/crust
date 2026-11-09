import { describe, expect, it } from "vite-plus/test";

import { widthCorpus } from "./string-width.corpus.ts";
import { stringWidth } from "./string-width.ts";

describe("stringWidth", () => {
	// Tests run on Node, where stringWidth is the JS fallback.
	it("matches the corpus", () => {
		for (const [label, input, expected] of widthCorpus) {
			expect(stringWidth(input), label).toBe(expected);
		}
	});
});
