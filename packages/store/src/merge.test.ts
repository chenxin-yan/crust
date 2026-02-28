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
	count: { type: "number", default: 0 },
} as const satisfies FieldsDef;

// ────────────────────────────────────────────────────────────────────────────
// applyFieldDefaults — No persisted data
// ────────────────────────────────────────────────────────────────────────────

describe("applyFieldDefaults", () => {
	it("should return all defaults when persisted is undefined", () => {
		const result = applyFieldDefaults(undefined, BASIC_FIELDS);

		expect(result).toEqual({
			theme: "light",
			verbose: false,
			retries: 3,
		});
	});

	it("should omit optional fields (no default) when persisted is undefined", () => {
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

	it("should fill missing persisted keys from field defaults", () => {
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

		expect(result.theme).toBe("dark");
		expect(result.verbose).toBe(true);
		expect(result.token).toBe("abc123");
	});

	// ──────────────────────────────────────────────────────────────────────
	// Unknown keys — pruneUnknown
	// ──────────────────────────────────────────────────────────────────────

	it("should drop persisted keys not defined in fields (default)", () => {
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

	it("should preserve unknown keys when pruneUnknown is false", () => {
		const persisted = {
			theme: "dark",
			verbose: true,
			retries: 5,
			extra: "kept",
		};
		const result = applyFieldDefaults(persisted, BASIC_FIELDS, false);

		expect(result as Record<string, unknown>).toEqual({
			theme: "dark",
			verbose: true,
			retries: 5,
			extra: "kept",
		});
	});

	it("should still fill missing defaults when pruneUnknown is false", () => {
		const persisted = { theme: "dark", extra: "kept" };
		const result = applyFieldDefaults(persisted, BASIC_FIELDS, false);

		expect(result as Record<string, unknown>).toEqual({
			theme: "dark",
			verbose: false,
			retries: 3,
			extra: "kept",
		});
	});

	// ──────────────────────────────────────────────────────────────────────
	// Array fields
	// ──────────────────────────────────────────────────────────────────────

	it("should apply array defaults", () => {
		const result = applyFieldDefaults(undefined, ARRAY_FIELDS);

		expect(result.tags).toEqual(["default"]);
		expect(result.count).toBe(0);
	});

	it("should use persisted array values", () => {
		const persisted = { tags: ["a", "b"], count: 42 };
		const result = applyFieldDefaults(persisted, ARRAY_FIELDS);

		expect(result).toEqual({
			tags: ["a", "b"],
			count: 42,
		});
	});

	it("should replace arrays wholesale, not merge elements", () => {
		const persisted = { tags: ["a"], count: 1 };
		const result = applyFieldDefaults(persisted, ARRAY_FIELDS);

		expect(result.tags).toEqual(["a"]);
	});

	// ──────────────────────────────────────────────────────────────────────
	// Edge cases — falsy values preserved
	// ──────────────────────────────────────────────────────────────────────

	it("should handle empty defaults", () => {
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

	// ──────────────────────────────────────────────────────────────────────
	// Immutability — cloned arrays
	// ──────────────────────────────────────────────────────────────────────

	it("should shallow-copy array defaults to prevent shared mutation", () => {
		const fields = {
			tags: { type: "string", array: true, default: ["a", "b"] },
		} as const satisfies FieldsDef;

		const result1 = applyFieldDefaults(undefined, fields);
		const result2 = applyFieldDefaults(undefined, fields);

		(result1.tags as string[]).push("c");
		expect(result2.tags).toEqual(["a", "b"]);
	});

	it("should clone persisted arrays to detach from parsed input", () => {
		const persisted = { tags: ["x", "y"], count: 0 };

		const result = applyFieldDefaults(persisted, ARRAY_FIELDS);
		(result.tags as string[]).push("z");

		expect(persisted.tags).toEqual(["x", "y"]);
	});

	it("should handle pruneUnknown=false with no persisted data", () => {
		const result = applyFieldDefaults(undefined, BASIC_FIELDS, false);

		expect(result).toEqual({
			theme: "light",
			verbose: false,
			retries: 3,
		});
	});
});
