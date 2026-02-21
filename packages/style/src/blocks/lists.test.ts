import { describe, expect, it } from "bun:test";
import { red } from "../colors.ts";
import { bold } from "../modifiers.ts";
import { orderedList, taskList, unorderedList } from "./lists.ts";

// ────────────────────────────────────────────────────────────────────────────
// Unordered List
// ────────────────────────────────────────────────────────────────────────────

describe("unorderedList", () => {
	it("formats a single item with default bullet", () => {
		expect(unorderedList(["alpha"])).toBe("\u2022 alpha");
	});

	it("formats multiple items", () => {
		const result = unorderedList(["alpha", "beta", "gamma"]);
		expect(result).toBe("\u2022 alpha\n\u2022 beta\n\u2022 gamma");
	});

	it("uses custom marker", () => {
		const result = unorderedList(["a", "b"], { marker: "-" });
		expect(result).toBe("- a\n- b");
	});

	it("uses custom marker gap", () => {
		const result = unorderedList(["item"], { marker: "*", markerGap: 3 });
		expect(result).toBe("*   item");
	});

	it("applies base indentation", () => {
		const result = unorderedList(["a", "b"], { marker: "-", indent: 4 });
		expect(result).toBe("    - a\n    - b");
	});

	it("handles empty items array", () => {
		expect(unorderedList([])).toBe("");
	});

	it("aligns multiline item continuation under content", () => {
		const result = unorderedList(["first\nsecond line"], { marker: "-" });
		// continuation should be indented by marker width (1) + gap (1) = 2 spaces
		expect(result).toBe("- first\n  second line");
	});

	it("aligns multiline with multi-char marker", () => {
		const result = unorderedList(["line1\nline2"], {
			marker: ">>",
			markerGap: 1,
		});
		// marker ">>": visible width 2, gap 1 => continuation indent = 3
		expect(result).toBe(">> line1\n   line2");
	});

	it("handles multiline items with indentation", () => {
		const result = unorderedList(["line1\nline2"], { marker: "-", indent: 2 });
		// indent 2 + marker width 1 + gap 1 = 4 continuation indent
		expect(result).toBe("  - line1\n    line2");
	});

	it("handles items with more than 2 lines", () => {
		const result = unorderedList(["a\nb\nc"], { marker: "-" });
		expect(result).toBe("- a\n  b\n  c");
	});

	it("works with styled items", () => {
		const styledItem = bold("important");
		const result = unorderedList([styledItem], { marker: "-" });
		expect(result).toBe(`- ${styledItem}`);
	});

	it("handles empty string items", () => {
		const result = unorderedList(["", "b"], { marker: "-" });
		expect(result).toBe("- \n- b");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Ordered List
// ────────────────────────────────────────────────────────────────────────────

describe("orderedList", () => {
	it("formats a single item", () => {
		expect(orderedList(["alpha"])).toBe("1. alpha");
	});

	it("formats multiple items", () => {
		const result = orderedList(["alpha", "beta", "gamma"]);
		expect(result).toBe("1. alpha\n2. beta\n3. gamma");
	});

	it("supports custom start index", () => {
		const result = orderedList(["a", "b"], { start: 5 });
		expect(result).toBe("5. a\n6. b");
	});

	it("handles empty items array", () => {
		expect(orderedList([])).toBe("");
	});

	it("aligns markers when crossing digit boundaries", () => {
		// 9 items starting at 1 => max marker is "9." (width 2), no extra padding needed
		const items9 = Array.from({ length: 9 }, (_, i) => `item${i + 1}`);
		const result9 = orderedList(items9);
		const lines9 = result9.split("\n");
		expect(lines9[0]).toBe("1. item1");
		expect(lines9[8]).toBe("9. item9");
	});

	it("right-pads single-digit markers to match double-digit width", () => {
		// 10 items starting at 1 => max marker is "10." (width 3)
		// Single-digit markers should be right-padded: " 1.", " 2.", etc.
		const items10 = Array.from({ length: 10 }, (_, i) => `item${i + 1}`);
		const result10 = orderedList(items10);
		const lines10 = result10.split("\n");
		expect(lines10[0]).toBe(" 1. item1");
		expect(lines10[8]).toBe(" 9. item9");
		expect(lines10[9]).toBe("10. item10");
	});

	it("handles 100+ items marker alignment", () => {
		const items = Array.from({ length: 100 }, (_, i) => `i${i + 1}`);
		const result = orderedList(items);
		const lines = result.split("\n");
		// Max marker "100." is width 4
		// "1." should be padded to "  1."
		expect(lines[0]).toBe("  1. i1");
		expect(lines[9]).toBe(" 10. i10");
		expect(lines[99]).toBe("100. i100");
	});

	it("applies base indentation", () => {
		const result = orderedList(["a", "b"], { indent: 3 });
		expect(result).toBe("   1. a\n   2. b");
	});

	it("uses custom marker gap", () => {
		const result = orderedList(["item"], { markerGap: 3 });
		expect(result).toBe("1.   item");
	});

	it("aligns multiline item continuation", () => {
		const result = orderedList(["first\nsecond"]);
		// marker "1." width 2 + gap 1 = 3 continuation indent
		expect(result).toBe("1. first\n   second");
	});

	it("aligns multiline with double-digit markers", () => {
		const items = Array.from({ length: 10 }, (_, i) =>
			i === 0 ? "line1\nline2" : `item${i + 1}`,
		);
		const result = orderedList(items);
		const lines = result.split("\n");
		// Max marker "10." width 3 + gap 1 = 4 continuation indent
		expect(lines[0]).toBe(" 1. line1");
		expect(lines[1]).toBe("    line2");
	});

	it("works with styled items", () => {
		const styledItem = red("error");
		const result = orderedList([styledItem]);
		expect(result).toBe(`1. ${styledItem}`);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Task List
// ────────────────────────────────────────────────────────────────────────────

describe("taskList", () => {
	it("formats checked and unchecked items", () => {
		const result = taskList([
			{ text: "Done", checked: true },
			{ text: "Pending", checked: false },
		]);
		expect(result).toBe("[x] Done\n[ ] Pending");
	});

	it("handles all checked items", () => {
		const result = taskList([
			{ text: "a", checked: true },
			{ text: "b", checked: true },
		]);
		expect(result).toBe("[x] a\n[x] b");
	});

	it("handles all unchecked items", () => {
		const result = taskList([
			{ text: "a", checked: false },
			{ text: "b", checked: false },
		]);
		expect(result).toBe("[ ] a\n[ ] b");
	});

	it("uses custom markers", () => {
		const result = taskList(
			[
				{ text: "done", checked: true },
				{ text: "todo", checked: false },
			],
			{
				checkedMarker: "[X]",
				uncheckedMarker: "[ ]",
			},
		);
		expect(result).toBe("[X] done\n[ ] todo");
	});

	it("applies base indentation", () => {
		const result = taskList([{ text: "item", checked: false }], { indent: 2 });
		expect(result).toBe("  [ ] item");
	});

	it("uses custom marker gap", () => {
		const result = taskList([{ text: "item", checked: true }], {
			markerGap: 2,
		});
		expect(result).toBe("[x]  item");
	});

	it("handles empty items array", () => {
		expect(taskList([])).toBe("");
	});

	it("aligns multiline item continuation", () => {
		const result = taskList([
			{ text: "first line\nsecond line", checked: true },
		]);
		// marker "[x]" width 3 + gap 1 = 4 continuation indent
		expect(result).toBe("[x] first line\n    second line");
	});

	it("handles multiline with indentation", () => {
		const result = taskList([{ text: "line1\nline2", checked: false }], {
			indent: 2,
		});
		// indent 2 + marker "[x]" width 3 + gap 1 = 6 continuation indent
		expect(result).toBe("  [ ] line1\n      line2");
	});

	it("works with styled task text", () => {
		const styledText = bold("important task");
		const result = taskList([{ text: styledText, checked: false }]);
		expect(result).toBe(`[ ] ${styledText}`);
	});

	it("aligns with asymmetric marker widths", () => {
		const result = taskList(
			[
				{ text: "a", checked: true },
				{ text: "b", checked: false },
			],
			{
				checkedMarker: "YES",
				uncheckedMarker: "NO",
			},
		);
		// Both markers used; wider is "YES" (3), but "NO" is (2)
		// Content should still align consistently since multiline indent
		// uses the max of the two marker widths
		expect(result).toBe("YES a\nNO b");
	});
});
