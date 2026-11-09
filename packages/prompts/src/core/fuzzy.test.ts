import { describe, expect, it } from "vite-plus/test";

import { fuzzyFilter, fuzzyMatch, highlightMatches } from "./fuzzy.ts";
import type { PromptTheme } from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// fuzzyMatch
// ────────────────────────────────────────────────────────────────────────────

describe("fuzzyMatch", () => {
	it("empty query matches everything", () => {
		const result = fuzzyMatch("", "anything");
		expect(result.match).toBe(true);
		expect(result.score).toBe(0);
		expect(result.indices).toEqual([]);
	});

	it("out-of-order characters do not match", () => {
		const result = fuzzyMatch("ba", "abc");
		expect(result.match).toBe(false);
		expect(result.score).toBe(0);
		expect(result.indices).toEqual([]);
	});

	it("scoring prefers contiguous matches", () => {
		// "ts" in "TypeScript" matches at indices [0, 4] (T...S)
		// "ts" in "tsconfig" matches at indices [0, 1] (ts) — consecutive bonus
		const nonContiguous = fuzzyMatch("ts", "TypeScript");
		const contiguous = fuzzyMatch("ts", "tsconfig");
		expect(contiguous.match).toBe(true);
		expect(nonContiguous.match).toBe(true);
		expect(contiguous.score).toBeGreaterThan(nonContiguous.score);
	});

	it("start-of-string bonus increases score", () => {
		const startsAtBeginning = fuzzyMatch("a", "abc");
		const startsLater = fuzzyMatch("a", "xyzabc");
		expect(startsAtBeginning.match).toBe(true);
		expect(startsLater.match).toBe(true);
		expect(startsAtBeginning.score).toBeGreaterThan(startsLater.score);
	});

	it("word boundary bonus increases score", () => {
		// "c" matching after a separator should score higher than mid-word
		const wordBoundary = fuzzyMatch("c", "foo-config");
		const midWord = fuzzyMatch("c", "abcdef");
		expect(wordBoundary.match).toBe(true);
		expect(midWord.match).toBe(true);
		expect(wordBoundary.score).toBeGreaterThan(midWord.score);
	});

	it("returns correct indices for sparse matches", () => {
		const result = fuzzyMatch("ace", "abcde");
		expect(result.match).toBe(true);
		expect(result.indices).toEqual([0, 2, 4]);
	});

	it("keeps indices on the original label when lowercasing changes its length", () => {
		// "İ".toLowerCase() is two UTF-16 units ("i" + U+0307).
		expect(fuzzyMatch("s", "İstanbul").indices).toEqual([1]);
		expect(fuzzyMatch("ist", "İstanbul").indices).toEqual([0, 1, 2]);
		expect(fuzzyMatch("İs", "İstanbul").indices).toEqual([0, 1]);
		const theme = { filterMatch: (text: string) => `[${text}]` } as PromptTheme;
		expect(highlightMatches("İstanbul", fuzzyMatch("s", "İstanbul").indices, theme)).toBe(
			"İ[s]tanbul",
		);
	});

	it("lowercases candidates in context like the query (Greek final sigma)", () => {
		// "ΟΣ".toLowerCase() is "ος"; lowercasing "Σ" alone gives "σ".
		expect(fuzzyMatch("ΟΣ", "ΟΣ")).toMatchObject({ match: true, indices: [0, 1] });
		expect(fuzzyMatch("ος", "ΟΣ")).toMatchObject({ match: true, indices: [0, 1] });
	});

	it("keeps both UTF-16 units of astral characters in indices", () => {
		// Deseret U+10400 lowercases to U+10428; both are surrogate pairs.
		expect(fuzzyMatch("\u{10428}b", "\u{10400}b").indices).toEqual([0, 1, 2]);
		expect(fuzzyMatch("b", "\u{1F600}b").indices).toEqual([2]);
	});

	it("applies the word boundary bonus from the original previous character", () => {
		// Lowercased indices are shifted by "İ", so the bonus must read "-" from the original label.
		expect(fuzzyMatch("b", "İ-b").score).toBe(fuzzyMatch("b", "x-b").score);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// fuzzyFilter
// ────────────────────────────────────────────────────────────────────────────

describe("fuzzyFilter", () => {
	const items = [
		{ label: "TypeScript", value: "ts" },
		{ label: "JavaScript", value: "js" },
		{ label: "Rust", value: "rs" },
		{ label: "Python", value: "py" },
		{ label: "Go", value: "go" },
	];

	it("empty query returns all items", () => {
		const results = fuzzyFilter("", items);
		expect(results.length).toBe(items.length);
		for (const r of results) {
			expect(r.score).toBe(0);
			expect(r.indices).toEqual([]);
		}
	});

	it("sorts results by descending score", () => {
		// `config` scores higher than `abc` because the match lands at the
		// start of the string (START_BONUS). `xyz` does not match at all.
		const results = fuzzyFilter("c", [
			{ label: "abc", value: "abc" },
			{ label: "config", value: "config" },
			{ label: "xyz", value: "xyz" },
		]);

		expect(results.map((r) => r.item.label)).toEqual(["config", "abc"]);
	});
});
