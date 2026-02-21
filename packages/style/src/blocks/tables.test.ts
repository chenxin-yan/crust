import { describe, expect, it } from "bun:test";
import { red } from "../colors.ts";
import { bold } from "../modifiers.ts";
import { table } from "./tables.ts";

// ────────────────────────────────────────────────────────────────────────────
// Table
// ────────────────────────────────────────────────────────────────────────────

describe("table", () => {
	it("formats a simple 2-column table", () => {
		const result = table(
			["Name", "Age"],
			[
				["Alice", "30"],
				["Bob", "25"],
			],
		);
		const lines = result.split("\n");
		expect(lines).toHaveLength(4); // header + separator + 2 data rows
		expect(lines[0]).toBe("| Name  | Age |");
		expect(lines[1]).toBe("|-------|-----|");
		expect(lines[2]).toBe("| Alice | 30  |");
		expect(lines[3]).toBe("| Bob   | 25  |");
	});

	it("formats a single-column table", () => {
		const result = table(["Item"], [["apple"], ["banana"]]);
		const lines = result.split("\n");
		expect(lines[0]).toBe("| Item   |");
		expect(lines[1]).toBe("|--------|");
		expect(lines[2]).toBe("| apple  |");
		expect(lines[3]).toBe("| banana |");
	});

	it("handles table with no data rows", () => {
		const result = table(["A", "B"], []);
		const lines = result.split("\n");
		expect(lines).toHaveLength(2); // header + separator only
		expect(lines[0]).toBe("| A | B |");
		expect(lines[1]).toBe("|---|---|");
	});

	it("auto-sizes columns from header and data widths", () => {
		const result = table(
			["ID", "Description"],
			[
				["1", "Short"],
				["2", "A longer description text"],
			],
		);
		const lines = result.split("\n");
		// "Description" header is width 11, but "A longer description text" is width 24
		// Column should size to 24
		expect(lines[0]).toBe("| ID | Description               |");
		expect(lines[2]).toBe("| 1  | Short                     |");
		expect(lines[3]).toBe("| 2  | A longer description text |");
	});

	// ── Alignment ──────────────────────────────────────────────────────────

	it("right-aligns a column", () => {
		const result = table(
			["Name", "Score"],
			[
				["Alice", "100"],
				["Bob", "5"],
			],
			{ align: ["left", "right"] },
		);
		const lines = result.split("\n");
		expect(lines[0]).toBe("| Name  | Score |");
		expect(lines[2]).toBe("| Alice |   100 |");
		expect(lines[3]).toBe("| Bob   |     5 |");
	});

	it("center-aligns a column", () => {
		const result = table(
			["Name", "Status"],
			[
				["Alice", "OK"],
				["Bob", "FAIL"],
			],
			{ align: ["left", "center"] },
		);
		const lines = result.split("\n");
		// "Status" (6 wide) — "OK" centered in 6 = "  OK  ", "FAIL" centered in 6 = " FAIL "
		expect(lines[0]).toBe("| Name  | Status |");
		expect(lines[2]).toBe("| Alice |   OK   |");
		expect(lines[3]).toBe("| Bob   |  FAIL  |");
	});

	it("defaults unspecified alignment to left", () => {
		const result = table(
			["A", "B", "C"],
			[["1", "2", "3"]],
			{ align: ["right"] }, // only first column specified
		);
		const lines = result.split("\n");
		expect(lines[0]).toBe("| A | B | C |");
		expect(lines[2]).toBe("| 1 | 2 | 3 |");
	});

	// ── Options ────────────────────────────────────────────────────────────

	it("respects minColumnWidth", () => {
		const result = table(["A", "B"], [["1", "2"]], { minColumnWidth: 5 });
		const lines = result.split("\n");
		// Columns should be at least 5 wide even though content is only 1 wide
		expect(lines[0]).toBe("| A     | B     |");
		expect(lines[1]).toBe("|-------|-------|");
	});

	it("respects custom cellPadding", () => {
		const result = table(["A", "B"], [["1", "2"]], { cellPadding: 2 });
		const lines = result.split("\n");
		expect(lines[0]).toBe("|  A  |  B  |");
		expect(lines[1]).toBe("|-----|-----|");
		expect(lines[2]).toBe("|  1  |  2  |");
	});

	it("respects cellPadding of 0", () => {
		const result = table(["A", "B"], [["1", "2"]], { cellPadding: 0 });
		const lines = result.split("\n");
		expect(lines[0]).toBe("|A|B|");
		expect(lines[1]).toBe("|-|-|");
		expect(lines[2]).toBe("|1|2|");
	});

	it("uses custom separator character", () => {
		const result = table(["A"], [["1"]], { separatorChar: "=" });
		const lines = result.split("\n");
		expect(lines[1]).toBe("|===|");
	});

	it("uses custom border character", () => {
		const result = table(["A"], [["1"]], { borderChar: ":" });
		const lines = result.split("\n");
		expect(lines[0]).toBe(": A :");
		expect(lines[1]).toBe(":---:");
		expect(lines[2]).toBe(": 1 :");
	});

	// ── ANSI Styled Content ────────────────────────────────────────────────

	it("handles ANSI-styled header values", () => {
		const styledHeader = bold("Name");
		const result = table([styledHeader, "Age"], [["Alice", "30"]]);
		const lines = result.split("\n");
		// The column should size based on visible width of "Name" (4), not the raw ANSI string length
		// "Alice" is wider (5), so column width should be 5
		expect(lines[2]).toBe("| Alice | 30  |");
	});

	it("handles ANSI-styled cell values", () => {
		const styledCell = red("error");
		const result = table(["Status"], [[styledCell], ["ok"]]);
		const lines = result.split("\n");
		// "Status" (6) is widest => column width 6
		// "error" visible width is 5, padded to 6
		expect(lines[0]).toBe("| Status |");
	});

	it("aligns ANSI-styled cells correctly with plain cells", () => {
		const styledName = bold("Alice");
		const result = table(
			["Name", "Score"],
			[
				[styledName, "100"],
				["Bob", "5"],
			],
			{ align: ["left", "right"] },
		);
		const lines = result.split("\n");
		// Both names are 5 visible chars wide, so column is 5
		// Score column: "Score" is 5, "100" is 3, "5" is 1 => column width 5
		expect(lines[2]).toContain("Alice");
		expect(lines[3]).toBe("| Bob   |     5 |");
	});

	// ── Edge Cases ─────────────────────────────────────────────────────────

	it("handles missing cells in rows (fewer than headers)", () => {
		const result = table(["A", "B", "C"], [["1", "2"], ["x"]]);
		const lines = result.split("\n");
		// Missing cells should be treated as empty strings
		expect(lines[2]).toBe("| 1 | 2 |   |");
		expect(lines[3]).toBe("| x |   |   |");
	});

	it("handles empty header strings", () => {
		const result = table(["", "B"], [["1", "2"]]);
		const lines = result.split("\n");
		// Column width is max(0, 1) = 1; header cell is empty string padded to 1
		expect(lines[0]).toBe("|   | B |");
		expect(lines[2]).toBe("| 1 | 2 |");
	});

	it("handles CJK characters in cells", () => {
		const result = table(
			["Name", "Value"],
			[
				["\u4f60\u597d", "hi"],
				["ab", "cd"],
			],
		);
		const lines = result.split("\n");
		// "\u4f60\u597d" is 4 visible columns, "Name" is 4 => column width 4
		expect(lines[0]).toBe("| Name | Value |");
		expect(lines[2]).toBe("| \u4f60\u597d | hi    |");
		expect(lines[3]).toBe("| ab   | cd    |");
	});

	it("handles three columns with mixed alignment", () => {
		const result = table(
			["Left", "Center", "Right"],
			[
				["aa", "bb", "cc"],
				["dddd", "ee", "ffffff"],
			],
			{ align: ["left", "center", "right"] },
		);
		const lines = result.split("\n");
		expect(lines[0]).toBe("| Left | Center |  Right |");
		expect(lines[2]).toBe("| aa   |   bb   |     cc |");
		expect(lines[3]).toBe("| dddd |   ee   | ffffff |");
	});
});
