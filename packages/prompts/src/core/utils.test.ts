import { describe, expect, it } from "bun:test";

import { formatPromptLine, formatSubmitted, moveCursor, normalizeChoices } from "./utils.ts";

// ────────────────────────────────────────────────────────────────────────────
// formatSubmitted
// ────────────────────────────────────────────────────────────────────────────

describe("formatSubmitted", () => {
	it("formats values with and without a message", () => {
		expect(formatSubmitted("✔", "Name?", "Alice")).toBe("✔ Name? Alice");
		expect(formatSubmitted("✔", undefined, "Alice")).toBe("✔ Alice");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// formatPromptLine
// ────────────────────────────────────────────────────────────────────────────

describe("formatPromptLine", () => {
	it("formats content with and without a message", () => {
		expect(formatPromptLine("○", "Name?", "Alice")).toBe("○ Name?\n  Alice");
		expect(formatPromptLine("○", undefined, "Alice")).toBe("○ Alice");
	});
});

describe("moveCursor", () => {
	it("wraps and updates the viewport", () => {
		expect(moveCursor(0, 5, -1, 0, 3)).toEqual({ cursor: 4, scrollOffset: 2 });
		expect(moveCursor(4, 5, 1, 2, 3)).toEqual({ cursor: 0, scrollOffset: 0 });
	});
});

// ────────────────────────────────────────────────────────────────────────────
// normalizeChoices
// ────────────────────────────────────────────────────────────────────────────

describe("normalizeChoices", () => {
	it("converts string choices to { label, value } objects", () => {
		const result = normalizeChoices(["red", "green", "blue"]);

		expect(result).toEqual([
			{ label: "red", value: "red" },
			{ label: "green", value: "green" },
			{ label: "blue", value: "blue" },
		]);
	});

	it("passes through object choices unchanged", () => {
		const choices = [
			{ label: "HTTP", value: 80 },
			{ label: "HTTPS", value: 443, hint: "recommended" },
		];

		const result = normalizeChoices(choices);

		expect(result).toEqual([
			{ label: "HTTP", value: 80 },
			{ label: "HTTPS", value: 443, hint: "recommended" },
		]);
	});
});
