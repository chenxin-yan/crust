import { describe, expect, it } from "bun:test";
import { fuzzyFilter, fuzzyMatch } from "./fuzzy.ts";

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

	it("exact match scores highest", () => {
		const exact = fuzzyMatch("hello", "hello");
		const partial = fuzzyMatch("hlo", "hello");
		expect(exact.match).toBe(true);
		expect(partial.match).toBe(true);
		expect(exact.score).toBeGreaterThan(partial.score);
	});

	it("substring match works", () => {
		const result = fuzzyMatch("ell", "hello");
		expect(result.match).toBe(true);
		expect(result.indices).toEqual([1, 2, 3]);
	});

	it("out-of-order characters do not match", () => {
		const result = fuzzyMatch("ba", "abc");
		expect(result.match).toBe(false);
		expect(result.score).toBe(0);
		expect(result.indices).toEqual([]);
	});

	it("case-insensitive matching", () => {
		const result = fuzzyMatch("ABC", "abcdef");
		expect(result.match).toBe(true);
		expect(result.indices).toEqual([0, 1, 2]);
	});

	it("case-insensitive matching reverse direction", () => {
		const result = fuzzyMatch("abc", "ABCDEF");
		expect(result.match).toBe(true);
		expect(result.indices).toEqual([0, 1, 2]);
	});

	it("scoring prefers contiguous matches", () => {
		// "ts" in "TypeScript" matches at indices [0, 4] (T...S)
		// "ts" in "tests" matches at indices [0, 1] (te) — consecutive bonus
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

	it("query longer than candidate does not match", () => {
		const result = fuzzyMatch("longquery", "hi");
		expect(result.match).toBe(false);
	});

	it("single character match works", () => {
		const result = fuzzyMatch("x", "fox");
		expect(result.match).toBe(true);
		expect(result.indices).toEqual([2]);
	});

	it("matching empty candidate with non-empty query fails", () => {
		const result = fuzzyMatch("a", "");
		expect(result.match).toBe(false);
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

	it("filters items that match the query", () => {
		const results = fuzzyFilter("py", items);
		expect(results.length).toBe(1);
		expect(results[0]?.item.value).toBe("py");
	});

	it("sorts results by score descending", () => {
		// "go" should match "Go" better than anything else
		const results = fuzzyFilter("go", items);
		expect(results.length).toBeGreaterThanOrEqual(1);
		expect(results[0]?.item.value).toBe("go");
	});

	it("returns empty array when nothing matches", () => {
		const results = fuzzyFilter("xyz", items);
		expect(results.length).toBe(0);
	});

	it("case-insensitive filtering", () => {
		const results = fuzzyFilter("RUST", items);
		expect(results.length).toBe(1);
		expect(results[0]?.item.value).toBe("rs");
	});

	it("returns indices for each matched item", () => {
		const results = fuzzyFilter("go", items);
		const goResult = results.find((r) => r.item.value === "go");
		expect(goResult).toBeDefined();
		expect(goResult?.indices.length).toBeGreaterThan(0);
	});

	it("preserves item references", () => {
		const results = fuzzyFilter("py", items);
		expect(results[0]?.item).toBe(items[3]);
	});
});
