import { describe, expect, it } from "bun:test";
import { normalizeChoices } from "./utils.ts";

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
