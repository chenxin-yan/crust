import { describe, expect, it } from "bun:test";
import {
	formatHeader,
	formatPromptLine,
	formatSubmitted,
	normalizeChoices,
} from "./utils.ts";

// ────────────────────────────────────────────────────────────────────────────
// formatHeader
// ────────────────────────────────────────────────────────────────────────────

describe("formatHeader", () => {
	it("returns prefix + message when message is provided", () => {
		expect(formatHeader("○", "Name?")).toBe("○ Name?");
	});

	it("returns only prefix when message is undefined", () => {
		expect(formatHeader("○", undefined)).toBe("○");
	});

	it("returns only prefix when message is empty string", () => {
		expect(formatHeader("○", "")).toBe("○");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// formatSubmitted
// ────────────────────────────────────────────────────────────────────────────

describe("formatSubmitted", () => {
	it("returns prefix + message + value when all provided", () => {
		expect(formatSubmitted("✔", "Name?", "Alice")).toBe("✔ Name? Alice");
	});

	it("returns prefix + value when message is undefined", () => {
		expect(formatSubmitted("✔", undefined, "Alice")).toBe("✔ Alice");
	});

	it("returns prefix + message when value is undefined", () => {
		expect(formatSubmitted("✔", "Name?", undefined)).toBe("✔ Name?");
	});

	it("returns only prefix when both message and value are undefined", () => {
		expect(formatSubmitted("✔", undefined, undefined)).toBe("✔");
	});

	it("returns prefix + value when message is empty string", () => {
		expect(formatSubmitted("✔", "", "Alice")).toBe("✔ Alice");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// formatPromptLine
// ────────────────────────────────────────────────────────────────────────────

describe("formatPromptLine", () => {
	it("renders two lines when message is provided", () => {
		expect(formatPromptLine("○", "Name?", "Alice")).toBe("○ Name?\n  Alice");
	});

	it("renders single line when message is undefined", () => {
		expect(formatPromptLine("○", undefined, "Alice")).toBe("○ Alice");
	});

	it("renders single line when message is empty string", () => {
		expect(formatPromptLine("○", "", "Alice")).toBe("○ Alice");
	});

	it("appends suffix to header when message is provided", () => {
		expect(formatPromptLine("○", "Name?", "Alice", " (default)")).toBe(
			"○ Name? (default)\n  Alice",
		);
	});

	it("appends suffix after prefix when message is undefined", () => {
		expect(formatPromptLine("○", undefined, "Alice", " (default)")).toBe(
			"○ (default) Alice",
		);
	});

	it("handles empty content with message", () => {
		expect(formatPromptLine("○", "Name?", "")).toBe("○ Name?\n  ");
	});

	it("handles empty content without message", () => {
		expect(formatPromptLine("○", undefined, "")).toBe("○ ");
	});

	it("omits suffix when not provided (with message)", () => {
		const withoutSuffix = formatPromptLine("○", "Name?", "val");
		const withUndefined = formatPromptLine("○", "Name?", "val", undefined);
		expect(withoutSuffix).toBe(withUndefined);
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

	it("handles mixed string and object choices", () => {
		const choices: Array<
			string | { label: string; value: string; hint?: string }
		> = ["plain", { label: "Fancy", value: "fancy", hint: "with hint" }];

		const result = normalizeChoices(choices);

		expect(result).toEqual([
			{ label: "plain", value: "plain" },
			{ label: "Fancy", value: "fancy", hint: "with hint" },
		]);
	});

	it("returns empty array for empty input", () => {
		const result = normalizeChoices([]);

		expect(result).toEqual([]);
	});

	it("preserves hint property on object choices", () => {
		const result = normalizeChoices([
			{ label: "Option A", value: "a", hint: "first option" },
		]);

		expect(result[0]?.hint).toBe("first option");
	});

	it("string choices have no hint property", () => {
		const result = normalizeChoices(["option"]);

		expect(result[0]?.hint).toBeUndefined();
	});
});
