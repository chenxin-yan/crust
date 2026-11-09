import { describe, expect, it } from "vite-plus/test";

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

// ────────────────────────────────────────────────────────────────────────────
// applyFieldDefaults
// ────────────────────────────────────────────────────────────────────────────

describe("applyFieldDefaults", () => {
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

	// ──────────────────────────────────────────────────────────────────────
	// Edge cases — falsy values preserved
	// ──────────────────────────────────────────────────────────────────────

	it("should preserve null as a persisted value", () => {
		const persisted = { theme: null, verbose: false, retries: 3 };
		const result = applyFieldDefaults(persisted, BASIC_FIELDS);

		expect(result.theme).toBeNull();
	});

	// ──────────────────────────────────────────────────────────────────────
	// Immutability — cloned defaults
	// ──────────────────────────────────────────────────────────────────────

	it("should copy array defaults to prevent shared mutation", () => {
		const fields = {
			tags: { type: "string", array: true, default: ["default"] },
		} as const satisfies FieldsDef;

		const result1 = applyFieldDefaults(undefined, fields);
		const result2 = applyFieldDefaults(undefined, fields);

		if (!Array.isArray(result1.tags)) expect.unreachable("expected the array default");
		result1.tags.push("mutated");

		expect(result2).toEqual({ tags: ["default"] });
	});

	// ──────────────────────────────────────────────────────────────────────
	// Own-property semantics
	// ──────────────────────────────────────────────────────────────────────

	it("treats Object.prototype names as ordinary keys", () => {
		const persisted = JSON.parse('{"constructor":"kept","toString":"t","__proto__":{"a":1}}');
		const result = applyFieldDefaults(persisted, {}, false);

		expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
		expect(Object.entries(result)).toEqual([
			["constructor", "kept"],
			["toString", "t"],
			["__proto__", { a: 1 }],
		]);
		expect(applyFieldDefaults(persisted, {})).toEqual({});
	});
});
