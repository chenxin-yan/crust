import { describe, expect, it } from "bun:test";
import { applyDefaults } from "./merge.ts";

// ────────────────────────────────────────────────────────────────────────────
// Test default objects
// ────────────────────────────────────────────────────────────────────────────

const BASIC_DEFAULTS = {
	theme: "light",
	verbose: false,
	retries: 3,
};

const NESTED_DEFAULTS = {
	ui: { theme: "light", fontSize: 14 },
	verbose: false,
};

const ARRAY_DEFAULTS = {
	tags: ["default"] as string[],
	count: 0,
};

// ────────────────────────────────────────────────────────────────────────────
// applyDefaults
// ────────────────────────────────────────────────────────────────────────────

describe("applyDefaults", () => {
	// ──────────────────────────────────────────────────────────────────────
	// No persisted data
	// ──────────────────────────────────────────────────────────────────────

	it("should return all defaults when persisted is undefined", () => {
		const result = applyDefaults(undefined, BASIC_DEFAULTS);

		expect(result).toEqual({
			theme: "light",
			verbose: false,
			retries: 3,
		});
	});

	it("should return nested defaults when persisted is undefined", () => {
		const result = applyDefaults(undefined, NESTED_DEFAULTS);

		expect(result.ui).toEqual({ theme: "light", fontSize: 14 });
		expect(result.verbose).toBe(false);
	});

	// ──────────────────────────────────────────────────────────────────────
	// Persisted data — full match
	// ──────────────────────────────────────────────────────────────────────

	it("should use persisted values when all keys are present", () => {
		const persisted = { theme: "dark", verbose: true, retries: 5 };
		const result = applyDefaults(persisted, BASIC_DEFAULTS);

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
		const result = applyDefaults(persisted, BASIC_DEFAULTS);

		expect(result).toEqual({
			theme: "dark",
			verbose: false,
			retries: 3,
		});
	});

	// ──────────────────────────────────────────────────────────────────────
	// Extra keys in persisted are dropped
	// ──────────────────────────────────────────────────────────────────────

	it("should drop persisted keys not defined in defaults", () => {
		const persisted = {
			theme: "dark",
			verbose: true,
			retries: 5,
			unknown: "extra",
		};
		const result = applyDefaults(persisted, BASIC_DEFAULTS);

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
		const result = applyDefaults(undefined, ARRAY_DEFAULTS);

		expect(result.tags).toEqual(["default"]);
		expect(result.count).toBe(0);
	});

	it("should use persisted array values", () => {
		const persisted = { tags: ["a", "b"], count: 42 };
		const result = applyDefaults(persisted, ARRAY_DEFAULTS);

		expect(result).toEqual({
			tags: ["a", "b"],
			count: 42,
		});
	});

	it("should shallow-copy array defaults to prevent shared mutation", () => {
		const defaults = { tags: ["a", "b"] };

		const result1 = applyDefaults(undefined, defaults);
		const result2 = applyDefaults(undefined, defaults);

		// Mutating one result should not affect the other
		(result1.tags as string[]).push("c");
		expect(result2.tags).toEqual(["a", "b"]);
	});

	it("should shallow-copy object defaults to prevent shared mutation", () => {
		const defaults = { ui: { theme: "light" } };

		const result1 = applyDefaults(undefined, defaults);
		const result2 = applyDefaults(undefined, defaults);

		// Mutating one result should not affect the other
		(result1.ui as Record<string, unknown>).theme = "dark";
		expect((result2.ui as Record<string, unknown>).theme).toBe("light");
	});

	// ──────────────────────────────────────────────────────────────────────
	// Edge cases
	// ──────────────────────────────────────────────────────────────────────

	it("should handle empty defaults", () => {
		const result = applyDefaults({ extra: "value" }, {});
		expect(result).toEqual({});
	});

	it("should handle empty persisted object", () => {
		const result = applyDefaults({}, BASIC_DEFAULTS);

		expect(result).toEqual({
			theme: "light",
			verbose: false,
			retries: 3,
		});
	});

	it("should preserve null as a persisted value", () => {
		const persisted = { theme: null, verbose: false, retries: 3 };
		const result = applyDefaults(persisted, BASIC_DEFAULTS);

		expect(result.theme).toBeNull();
	});

	it("should preserve zero as a persisted value", () => {
		const persisted = { retries: 0 };
		const result = applyDefaults(persisted, BASIC_DEFAULTS);

		expect(result.retries).toBe(0);
	});

	it("should preserve empty string as a persisted value", () => {
		const persisted = { theme: "" };
		const result = applyDefaults(persisted, BASIC_DEFAULTS);

		expect(result.theme).toBe("");
	});

	it("should preserve false as a persisted value", () => {
		const persisted = { verbose: false };
		const result = applyDefaults(persisted, BASIC_DEFAULTS);

		expect(result.verbose).toBe(false);
	});
});
