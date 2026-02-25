import { describe, expect, it } from "bun:test";
import { applyFieldDefaults } from "./merge.ts";
import type { FieldsDef } from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Test field definitions
// ────────────────────────────────────────────────────────────────────────────

const BASIC_FIELDS = {
	theme: { type: "string", default: "light" },
	verbose: { type: "boolean", default: false },
	retries: { type: "number", default: 3 },
} as const satisfies FieldsDef;

const MIXED_FIELDS = {
	theme: { type: "string", default: "light" },
	verbose: { type: "boolean", default: false },
	token: { type: "string" },
} as const satisfies FieldsDef;

const ARRAY_FIELDS = {
	tags: { type: "string", array: true, default: ["default"] },
	ids: { type: "number", array: true },
} as const satisfies FieldsDef;

// ────────────────────────────────────────────────────────────────────────────
// applyFieldDefaults
// ────────────────────────────────────────────────────────────────────────────

describe("applyFieldDefaults", () => {
	// ──────────────────────────────────────────────────────────────────────
	// No persisted data
	// ──────────────────────────────────────────────────────────────────────

	it("should return all defaults when persisted is undefined", () => {
		const result = applyFieldDefaults(undefined, BASIC_FIELDS);

		expect(result).toEqual({
			theme: "light",
			verbose: false,
			retries: 3,
		});
	});

	it("should omit fields without defaults when persisted is undefined", () => {
		const result = applyFieldDefaults(undefined, MIXED_FIELDS);

		expect(result.theme).toBe("light");
		expect(result.verbose).toBe(false);
		expect(result.token).toBeUndefined();
		expect("token" in result).toBe(false);
	});

	// ──────────────────────────────────────────────────────────────────────
	// Persisted data — full match
	// ──────────────────────────────────────────────────────────────────────

	it("should use persisted values when all keys are present", () => {
		const persisted = { theme: "dark", verbose: true, retries: 5 };
		const result = applyFieldDefaults(persisted, BASIC_FIELDS);

		expect(result).toEqual({
			theme: "dark",
			verbose: true,
			retries: 5,
		});
	});

	// ──────────────────────────────────────────────────────────────────────
	// Persisted data — partial match
	// ──────────────────────────────────────────────────────────────────────

	it("should fill missing persisted keys from defaults", () => {
		const persisted = { theme: "dark" };
		const result = applyFieldDefaults(persisted, BASIC_FIELDS);

		expect(result).toEqual({
			theme: "dark",
			verbose: false,
			retries: 3,
		});
	});

	it("should include optional fields when persisted", () => {
		const persisted = { theme: "dark", verbose: true, token: "abc123" };
		const result = applyFieldDefaults(persisted, MIXED_FIELDS);

		expect(result).toEqual({
			theme: "dark",
			verbose: true,
			token: "abc123",
		});
	});

	// ──────────────────────────────────────────────────────────────────────
	// Extra keys in persisted are dropped
	// ──────────────────────────────────────────────────────────────────────

	it("should drop persisted keys not defined in fields", () => {
		const persisted = {
			theme: "dark",
			verbose: true,
			retries: 5,
			unknown: "extra",
		};
		const result = applyFieldDefaults(persisted, BASIC_FIELDS);

		expect(result).toEqual({
			theme: "dark",
			verbose: true,
			retries: 5,
		});
		expect("unknown" in result).toBe(false);
	});

	// ──────────────────────────────────────────────────────────────────────
	// Array fields
	// ──────────────────────────────────────────────────────────────────────

	it("should apply array defaults", () => {
		const result = applyFieldDefaults(undefined, ARRAY_FIELDS);

		expect(result.tags).toEqual(["default"]);
		expect(result.ids).toBeUndefined();
		expect("ids" in result).toBe(false);
	});

	it("should use persisted array values", () => {
		const persisted = { tags: ["a", "b"], ids: [1, 2, 3] };
		const result = applyFieldDefaults(persisted, ARRAY_FIELDS);

		expect(result).toEqual({
			tags: ["a", "b"],
			ids: [1, 2, 3],
		});
	});

	it("should shallow-copy array defaults to prevent shared mutation", () => {
		const fields = {
			tags: { type: "string", array: true, default: ["a", "b"] },
		} as const satisfies FieldsDef;

		const result1 = applyFieldDefaults(undefined, fields);
		const result2 = applyFieldDefaults(undefined, fields);

		// Mutating one result should not affect the other
		(result1.tags as string[]).push("c");
		expect(result2.tags).toEqual(["a", "b"]);
	});

	// ──────────────────────────────────────────────────────────────────────
	// Edge cases
	// ──────────────────────────────────────────────────────────────────────

	it("should handle empty fields definition", () => {
		const result = applyFieldDefaults({ extra: "value" }, {});
		expect(result).toEqual({});
	});

	it("should handle empty persisted object", () => {
		const result = applyFieldDefaults({}, BASIC_FIELDS);

		expect(result).toEqual({
			theme: "light",
			verbose: false,
			retries: 3,
		});
	});

	it("should preserve null as a persisted value", () => {
		const persisted = { theme: null, verbose: false, retries: 3 };
		const result = applyFieldDefaults(persisted, BASIC_FIELDS);

		expect(result.theme).toBeNull();
	});

	it("should preserve zero as a persisted value", () => {
		const persisted = { retries: 0 };
		const result = applyFieldDefaults(persisted, BASIC_FIELDS);

		expect(result.retries).toBe(0);
	});

	it("should preserve empty string as a persisted value", () => {
		const persisted = { theme: "" };
		const result = applyFieldDefaults(persisted, BASIC_FIELDS);

		expect(result.theme).toBe("");
	});

	it("should preserve false as a persisted value", () => {
		const persisted = { verbose: false };
		const result = applyFieldDefaults(persisted, BASIC_FIELDS);

		expect(result.verbose).toBe(false);
	});
});
