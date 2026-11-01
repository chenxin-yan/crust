import { describe, expect, it, vi } from "vite-plus/test";

import { widthCorpus } from "./string-width.corpus.ts";
import { stringWidth, stringWidthJs } from "./string-width.ts";

describe("stringWidth", () => {
	it("matches the corpus in the fallback and public API", () => {
		for (const [label, input, expected] of widthCorpus) {
			expect(stringWidthJs(input), label).toBe(expected);
			expect(stringWidth(input), label).toBe(expected);
		}
	});

	it("constructs the grapheme segmenter only for non-ASCII text", async () => {
		const segmenter = vi.spyOn(Intl, "Segmenter");
		try {
			vi.resetModules();
			const fresh = await import("./string-width.ts");
			expect(fresh.stringWidthJs("plain")).toBe(5);
			expect(fresh.stringWidthJs("\x1b[1m\x1b[36mstyled\x1b[39m\x1b[22m")).toBe(6);
			expect(segmenter).not.toHaveBeenCalled();
			expect(fresh.stringWidthJs("\x1b[36m你好\x1b[39m")).toBe(4);
			expect(fresh.stringWidthJs("é")).toBe(1);
			expect(segmenter).toHaveBeenCalledOnce();
		} finally {
			segmenter.mockRestore();
		}
	});
});
