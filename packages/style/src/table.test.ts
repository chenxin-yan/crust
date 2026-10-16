import { describe, expect, it } from "vite-plus/test";

import { table } from "./table.ts";

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

	// ── ANSI Styled Content ────────────────────────────────────────────────

	it("handles ANSI-styled cell values", () => {
		const styledCell = "\x1b[31merror\x1b[39m";
		const result = table(["Status"], [[styledCell], ["ok"]]);
		const lines = result.split("\n");
		// "Status" (6) is widest => column width 6
		// "error" visible width is 5, padded to 6
		expect(lines[2]).toBe("| \x1b[31merror\x1b[39m  |");
		expect(lines[3]).toBe("| ok     |");
	});

	// ── Edge Cases ─────────────────────────────────────────────────────────

	it("handles missing cells in rows (fewer than headers)", () => {
		const result = table(["A", "B", "C"], [["1", "2"], ["x"]]);
		const lines = result.split("\n");
		// Missing cells should be treated as empty strings
		expect(lines[2]).toBe("| 1 | 2 |   |");
		expect(lines[3]).toBe("| x |   |   |");
	});
});
