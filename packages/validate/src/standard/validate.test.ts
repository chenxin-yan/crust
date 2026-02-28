import { describe, expect, it } from "bun:test";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { ValidationIssue } from "../types.ts";
import type { StandardSchema, ValidationResult } from "./types.ts";
import {
	failure,
	isStandardSchema,
	normalizeStandardIssues,
	normalizeStandardPath,
	success,
	validateStandard,
	validateStandardSync,
} from "./validate.ts";

// ────────────────────────────────────────────────────────────────────────────
// Test helpers — minimal Standard Schema implementations
// ────────────────────────────────────────────────────────────────────────────

/** Create a sync Standard Schema that always succeeds with the input value. */
function passthroughSchema<T = unknown>(): StandardSchema<T, T> {
	return {
		"~standard": {
			version: 1,
			vendor: "test",
			validate: (value) => ({ value: value as T }),
		},
	};
}

/** Create a sync Standard Schema that always succeeds with a transformed value. */
function transformSchema<T>(output: T): StandardSchema<unknown, T> {
	return {
		"~standard": {
			version: 1,
			vendor: "test",
			validate: () => ({ value: output }),
		},
	};
}

/** Create a sync Standard Schema that always fails with the given issues. */
function failingSchema(
	issues: StandardSchemaV1.Issue[],
): StandardSchema<unknown, never> {
	return {
		"~standard": {
			version: 1,
			vendor: "test",
			validate: () => ({ issues }),
		},
	};
}

/** Create an async Standard Schema that resolves to success. */
function asyncPassthroughSchema<T = unknown>(): StandardSchema<T, T> {
	return {
		"~standard": {
			version: 1,
			vendor: "test",
			validate: async (value) => ({ value: value as T }),
		},
	};
}

/** Create an async Standard Schema that resolves to failure. */
function asyncFailingSchema(
	issues: StandardSchemaV1.Issue[],
): StandardSchema<unknown, never> {
	return {
		"~standard": {
			version: 1,
			vendor: "test",
			validate: async () => ({ issues }),
		},
	};
}

// ────────────────────────────────────────────────────────────────────────────
// isStandardSchema
// ────────────────────────────────────────────────────────────────────────────

describe("isStandardSchema", () => {
	it("returns true for valid Standard Schema v1 objects", () => {
		expect(isStandardSchema(passthroughSchema())).toBe(true);
	});

	it("returns true for async schemas", () => {
		expect(isStandardSchema(asyncPassthroughSchema())).toBe(true);
	});

	it("returns false for null", () => {
		expect(isStandardSchema(null)).toBe(false);
	});

	it("returns false for undefined", () => {
		expect(isStandardSchema(undefined)).toBe(false);
	});

	it("returns false for primitives", () => {
		expect(isStandardSchema(42)).toBe(false);
		expect(isStandardSchema("hello")).toBe(false);
		expect(isStandardSchema(true)).toBe(false);
	});

	it("returns false for plain objects without ~standard", () => {
		expect(isStandardSchema({})).toBe(false);
		expect(isStandardSchema({ version: 1 })).toBe(false);
	});

	it("returns false for objects with wrong version", () => {
		expect(
			isStandardSchema({
				"~standard": { version: 2, validate: () => ({ value: null }) },
			}),
		).toBe(false);
	});

	it("returns false for objects without validate function", () => {
		expect(
			isStandardSchema({
				"~standard": { version: 1, validate: "not a function" },
			}),
		).toBe(false);
	});

	it("returns false when ~standard is null", () => {
		expect(isStandardSchema({ "~standard": null })).toBe(false);
	});

	it("returns false when ~standard is a primitive", () => {
		expect(isStandardSchema({ "~standard": 42 })).toBe(false);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// normalizeStandardPath
// ────────────────────────────────────────────────────────────────────────────

describe("normalizeStandardPath", () => {
	it("returns empty array for undefined path", () => {
		expect(normalizeStandardPath(undefined)).toEqual([]);
	});

	it("returns empty array for empty path", () => {
		expect(normalizeStandardPath([])).toEqual([]);
	});

	it("passes through bare string keys", () => {
		expect(normalizeStandardPath(["a", "b"])).toEqual(["a", "b"]);
	});

	it("passes through bare numeric keys", () => {
		expect(normalizeStandardPath([0, 1])).toEqual([0, 1]);
	});

	it("unwraps PathSegment objects to their key", () => {
		expect(normalizeStandardPath([{ key: "name" }])).toEqual(["name"]);
	});

	it("unwraps numeric PathSegment objects", () => {
		expect(normalizeStandardPath([{ key: 0 }])).toEqual([0]);
	});

	it("handles mixed bare keys and PathSegment objects", () => {
		expect(normalizeStandardPath(["items", { key: 0 }, "name"])).toEqual([
			"items",
			0,
			"name",
		]);
	});

	it("handles symbol keys", () => {
		const sym = Symbol("test");
		expect(normalizeStandardPath([sym])).toEqual([sym]);
	});

	it("handles symbol keys inside PathSegment", () => {
		const sym = Symbol("test");
		expect(normalizeStandardPath([{ key: sym }])).toEqual([sym]);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// normalizeStandardIssues
// ────────────────────────────────────────────────────────────────────────────

describe("normalizeStandardIssues", () => {
	it("normalizes root-level issue without path", () => {
		const issues: StandardSchemaV1.Issue[] = [{ message: "Invalid input" }];
		expect(normalizeStandardIssues(issues)).toEqual([
			{ message: "Invalid input", path: "" },
		]);
	});

	it("normalizes issue with string path", () => {
		const issues: StandardSchemaV1.Issue[] = [
			{ message: "Required", path: ["name"] },
		];
		expect(normalizeStandardIssues(issues)).toEqual([
			{ message: "Required", path: "name" },
		]);
	});

	it("normalizes issue with nested path", () => {
		const issues: StandardSchemaV1.Issue[] = [
			{ message: "Too short", path: ["address", "street"] },
		];
		expect(normalizeStandardIssues(issues)).toEqual([
			{ message: "Too short", path: "address.street" },
		]);
	});

	it("normalizes issue with numeric path (array index)", () => {
		const issues: StandardSchemaV1.Issue[] = [
			{ message: "Invalid item", path: ["items", 0] },
		];
		expect(normalizeStandardIssues(issues)).toEqual([
			{ message: "Invalid item", path: "items[0]" },
		]);
	});

	it("normalizes issue with PathSegment objects", () => {
		const issues: StandardSchemaV1.Issue[] = [
			{ message: "Bad value", path: [{ key: "config" }, { key: "port" }] },
		];
		expect(normalizeStandardIssues(issues)).toEqual([
			{ message: "Bad value", path: "config.port" },
		]);
	});

	it("prepends prefix to issue paths", () => {
		const issues: StandardSchemaV1.Issue[] = [
			{ message: "Required", path: ["name"] },
		];
		expect(normalizeStandardIssues(issues, ["flags"])).toEqual([
			{ message: "Required", path: "flags.name" },
		]);
	});

	it("prepends prefix to root-level issues", () => {
		const issues: StandardSchemaV1.Issue[] = [{ message: "Invalid input" }];
		expect(normalizeStandardIssues(issues, ["args", 0])).toEqual([
			{ message: "Invalid input", path: "args[0]" },
		]);
	});

	it("handles multiple issues with mixed paths", () => {
		const issues: StandardSchemaV1.Issue[] = [
			{ message: "Required", path: ["name"] },
			{ message: "Invalid", path: ["items", 0, "value"] },
			{ message: "Root error" },
		];
		expect(normalizeStandardIssues(issues, ["config"])).toEqual([
			{ message: "Required", path: "config.name" },
			{ message: "Invalid", path: "config.items[0].value" },
			{ message: "Root error", path: "config" },
		]);
	});

	it("returns empty array for empty issues", () => {
		expect(normalizeStandardIssues([])).toEqual([]);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// success / failure result constructors
// ────────────────────────────────────────────────────────────────────────────

describe("success", () => {
	it("creates a success result with value", () => {
		const result = success(42);
		expect(result.ok).toBe(true);
		expect(result.value).toBe(42);
		expect(result.issues).toBeUndefined();
	});

	it("creates a success result with object value", () => {
		const obj = { name: "test" };
		const result = success(obj);
		expect(result.ok).toBe(true);
		expect(result.value).toBe(obj);
	});

	it("creates a success result with undefined value", () => {
		const result = success(undefined);
		expect(result.ok).toBe(true);
		expect(result.value).toBeUndefined();
	});
});

describe("failure", () => {
	it("creates a failure result with issues", () => {
		const issues: ValidationIssue[] = [{ message: "Required", path: "name" }];
		const result = failure(issues);
		expect(result.ok).toBe(false);
		expect(result.issues).toEqual(issues);
		expect(result.value).toBeUndefined();
	});

	it("creates a failure result with multiple issues", () => {
		const issues: ValidationIssue[] = [
			{ message: "Required", path: "name" },
			{ message: "Too short", path: "bio" },
		];
		const result = failure(issues);
		expect(result.ok).toBe(false);
		expect(result.issues).toHaveLength(2);
	});

	it("creates a failure result with empty issues", () => {
		const result = failure([]);
		expect(result.ok).toBe(false);
		expect(result.issues).toEqual([]);
	});
});

describe("ValidationResult discriminant", () => {
	it("discriminates success via ok property", () => {
		const result: ValidationResult<number> = success(42);
		if (result.ok) {
			const _value: number = result.value;
			expect(_value).toBe(42);
		} else {
			expect.unreachable("should be success");
		}
	});

	it("discriminates failure via ok property", () => {
		const result: ValidationResult<number> = failure([
			{ message: "bad", path: "" },
		]);
		if (!result.ok) {
			expect(result.issues).toHaveLength(1);
		} else {
			expect.unreachable("should be failure");
		}
	});
});

// ────────────────────────────────────────────────────────────────────────────
// validateStandard (async)
// ────────────────────────────────────────────────────────────────────────────

describe("validateStandard", () => {
	it("returns success for valid sync schema", async () => {
		const schema = passthroughSchema<string>();
		const result = await validateStandard(schema, "hello");
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toBe("hello");
		}
	});

	it("returns success for valid async schema", async () => {
		const schema = asyncPassthroughSchema<string>();
		const result = await validateStandard(schema, "hello");
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toBe("hello");
		}
	});

	it("returns transformed value on success", async () => {
		const schema = transformSchema(42);
		const result = await validateStandard(schema, "any");
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toBe(42);
		}
	});

	it("returns failure for invalid sync schema", async () => {
		const schema = failingSchema([{ message: "Expected string" }]);
		const result = await validateStandard(schema, 123);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.issues).toEqual([{ message: "Expected string", path: "" }]);
		}
	});

	it("returns failure for invalid async schema", async () => {
		const schema = asyncFailingSchema([
			{ message: "Expected string", path: ["name"] },
		]);
		const result = await validateStandard(schema, 123);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.issues).toEqual([
				{ message: "Expected string", path: "name" },
			]);
		}
	});

	it("prepends prefix to failure paths", async () => {
		const schema = failingSchema([{ message: "Required", path: ["value"] }]);
		const result = await validateStandard(schema, null, ["flags", "config"]);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.issues).toEqual([
				{ message: "Required", path: "flags.config.value" },
			]);
		}
	});

	it("prepends prefix to root-level failure", async () => {
		const schema = failingSchema([{ message: "Invalid" }]);
		const result = await validateStandard(schema, null, ["args", 0]);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.issues).toEqual([{ message: "Invalid", path: "args[0]" }]);
		}
	});

	it("handles multiple issues", async () => {
		const schema = failingSchema([
			{ message: "Too short", path: ["name"] },
			{ message: "Required", path: ["email"] },
		]);
		const result = await validateStandard(schema, {});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.issues).toHaveLength(2);
			expect(result.issues[0]).toEqual({ message: "Too short", path: "name" });
			expect(result.issues[1]).toEqual({ message: "Required", path: "email" });
		}
	});

	it("handles PathSegment objects in issue paths", async () => {
		const schema = failingSchema([
			{ message: "Bad", path: [{ key: "items" }, { key: 0 }] },
		]);
		const result = await validateStandard(schema, {});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.issues).toEqual([{ message: "Bad", path: "items[0]" }]);
		}
	});
});

// ────────────────────────────────────────────────────────────────────────────
// validateStandardSync
// ────────────────────────────────────────────────────────────────────────────

describe("validateStandardSync", () => {
	it("returns success for valid sync schema", () => {
		const schema = passthroughSchema<string>();
		const result = validateStandardSync(schema, "hello");
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toBe("hello");
		}
	});

	it("returns transformed value on success", () => {
		const schema = transformSchema(42);
		const result = validateStandardSync(schema, "any");
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toBe(42);
		}
	});

	it("returns failure for invalid sync schema", () => {
		const schema = failingSchema([{ message: "Expected string" }]);
		const result = validateStandardSync(schema, 123);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.issues).toEqual([{ message: "Expected string", path: "" }]);
		}
	});

	it("prepends prefix to failure paths", () => {
		const schema = failingSchema([{ message: "Required", path: ["value"] }]);
		const result = validateStandardSync(schema, null, ["flags", "config"]);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.issues).toEqual([
				{ message: "Required", path: "flags.config.value" },
			]);
		}
	});

	it("throws TypeError for async schemas", () => {
		const schema = asyncPassthroughSchema();
		expect(() => validateStandardSync(schema, "hello")).toThrow(TypeError);
		expect(() => validateStandardSync(schema, "hello")).toThrow(
			"Schema returned a Promise from validate(). Use validateStandard() for async schemas.",
		);
	});

	it("handles multiple issues", () => {
		const schema = failingSchema([
			{ message: "Too short", path: ["name"] },
			{ message: "Required" },
		]);
		const result = validateStandardSync(schema, {}, ["data"]);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.issues).toHaveLength(2);
			expect(result.issues[0]).toEqual({
				message: "Too short",
				path: "data.name",
			});
			expect(result.issues[1]).toEqual({ message: "Required", path: "data" });
		}
	});
});
